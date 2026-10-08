import {
  CatalogSchema,
  CopyRecordSchema,
  MappingSchema,
  type Catalog,
  type CopyRecord,
} from '@string-binder/contracts';
import type { UiBridge } from './bridge';
import { gunzipText, gzipText } from './codec';
import { setActivity } from './activity';
import { message } from './shared';
import { request } from './workflow-client';

/**
 * The saved-copy catalog (about 10 MB, 20k records) lives here, in the UI.
 * Parsing and patching it in the plugin controller ran on Figma's main thread
 * and froze Figma; the controller now asks for the few records it needs.
 */
export type CatalogStore = {
  get: () => Catalog | null;
  online: () => boolean;
  /** Pulls registry changes (or the whole catalog on first run). Overlapping calls share one sync. */
  sync: () => Promise<Catalog>;
  subscribe: (listener: (catalog: Catalog) => void) => () => void;
};

const stores = new WeakMap<UiBridge, CatalogStore>();

/** One store per bridge, created on first use so it hears `catalog:cached` after `ui:ready`. */
export function catalogStore(bridge: UiBridge): CatalogStore {
  let store = stores.get(bridge);
  if (!store) stores.set(bridge, (store = createStore(bridge)));
  return store;
}

type Delta = { seq: number; events: { type: string; record: unknown }[]; more: boolean };

const decoder = new TextDecoder();
const SAVE_DELAY_MS = 3000;
/** Records by copy ID, built once per catalog rather than on every query. */
const recordsById = new WeakMap<Catalog, Map<string, CopyRecord>>();
function byIdOf(catalog: Catalog): Map<string, CopyRecord> {
  let byId = recordsById.get(catalog);
  if (!byId) recordsById.set(catalog, (byId = new Map(catalog.records.map((r) => [r.copyId, r]))));
  return byId;
}
async function fetchJson<T>(bridge: UiBridge, path: string): Promise<T> {
  return JSON.parse(decoder.decode(await request<Uint8Array>(bridge, 'registry:fetch', { path })));
}

function createStore(bridge: UiBridge): CatalogStore {
  let current: Catalog | null = null;
  let online = false;
  let syncing: Promise<Catalog> | null = null;
  const listeners = new Set<(catalog: Catalog) => void>();
  let restoreDone!: () => void;
  // The saved copy comes with `ui:ready`; a sync waits for it (briefly) so it can fetch only changes.
  const restored = new Promise<void>((resolve) => (restoreDone = resolve));
  setTimeout(() => restoreDone(), 5000);

  // Serializing 10 MB blocks the UI for a moment; back-to-back syncs save once.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    saveTimer = null;
    if (current)
      void gzipText(JSON.stringify(current)).then((bytes) =>
        bridge.send({ type: 'catalog:save', bytes }),
      );
  };
  const publish = (next: Catalog, persist: boolean) => {
    current = next;
    for (const listener of [...listeners]) listener(next);
    if (persist) {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, SAVE_DELAY_MS);
    }
  };

  async function full(): Promise<Catalog> {
    setActivity('catalog', 'Downloading saved copy');
    // The full catalog endpoint is slow and sometimes answers 503; retry a couple of times.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return CatalogSchema.parse(await fetchJson(bridge, 'catalog'));
      } catch (e) {
        if (attempt >= 2) throw e;
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
  }

  async function changes(base: Catalog): Promise<Catalog | null> {
    let next: Catalog | null = null;
    let records: Map<string, CopyRecord> | null = null;
    let mappings: Map<string, Catalog['mappings'][number]> | null = null;
    let seq = base.seq;
    for (let more = true; more;) {
      const delta = await fetchJson<Delta>(bridge, `changes?after=${seq}`);
      if (delta.events.length) {
        setActivity('catalog', 'Updating saved copy');
        records ??= new Map(base.records.map((r) => [r.copyId, r]));
        mappings ??= new Map(base.mappings.map((m) => [`${m.libraryId}:${m.copyId}`, m]));
        for (const event of delta.events) {
          if (event.type === 'copy') {
            const r = CopyRecordSchema.parse(event.record);
            records.set(r.copyId, r);
          }
          if (event.type === 'mapping') {
            const m = MappingSchema.parse(event.record);
            mappings.set(`${m.libraryId}:${m.copyId}`, m);
          }
        }
      }
      if (delta.seq !== seq || records)
        next = {
          ...base,
          seq: delta.seq,
          records: records ? [...records.values()] : base.records,
          mappings: mappings ? [...mappings.values()] : base.mappings,
        };
      seq = delta.seq;
      more = delta.more;
    }
    return next;
  }

  async function run(): Promise<Catalog> {
    await restored;
    try {
      if (!current) publish(await full(), true);
      else {
        const next = await changes(current);
        if (next) publish(next, true);
      }
      online = true;
      return current!;
    } catch (e) {
      online = false;
      if (current) return current;
      throw e;
    } finally {
      setActivity('catalog', null);
    }
  }

  const sync = () => {
    syncing ??= run().finally(() => {
      syncing = null;
    });
    return syncing;
  };

  /** Records for `copyIds` and every record they were merged into (a few hops at most). */
  function slice(catalog: Catalog, copyIds: readonly string[]) {
    if (!copyIds.length) return { records: [], mappings: [] };
    const byId = byIdOf(catalog);
    const wanted = new Set<string>();
    for (const id of copyIds) {
      let at: string | undefined = id;
      for (let hop = 0; at && hop < 6 && !wanted.has(at); hop += 1) {
        wanted.add(at);
        at = byId.get(at)?.mergedInto ?? undefined;
      }
    }
    return {
      records: [...wanted].flatMap((id) => byId.get(id) ?? []),
      mappings: catalog.mappings.filter((m) => wanted.has(m.copyId)),
    };
  }

  bridge.subscribe((event) => {
    if (event.type === 'catalog:cached') {
      if (!event.bytes || current) return restoreDone();
      setActivity('catalog', 'Loading saved copy');
      gunzipText(event.bytes)
        // Written by this store, so it is not re-validated (that took seconds for 20k records).
        .then((text) => {
          if (!current) publish(JSON.parse(text) as Catalog, false);
        })
        .catch(() => {
          /* A broken cache just means a full download. */
        })
        .finally(() => {
          setActivity('catalog', null);
          restoreDone();
        });
      return;
    }
    if (event.type !== 'catalog:query') return;
    const { queryId, copyIds, fresh } = event;
    const answer = async () => {
      let catalog = current;
      if (fresh || !catalog) catalog = await sync().catch(() => current);
      else await restored;
      catalog ??= current;
      if (!catalog)
        return bridge.send({
          type: 'catalog:answer',
          queryId,
          seq: 0,
          records: [],
          mappings: [],
          products: [],
          online: false,
          error: 'Saved copy is unavailable offline. Try again when connected.',
        });
      bridge.send({
        type: 'catalog:answer',
        queryId,
        seq: catalog.seq,
        ...slice(catalog, copyIds),
        products: catalog.products,
        online,
      });
    };
    answer().catch((e) =>
      bridge.send({
        type: 'catalog:answer',
        queryId,
        seq: 0,
        records: [],
        mappings: [],
        products: [],
        online: false,
        error: message(e),
      }),
    );
  });

  return {
    get: () => current,
    online: () => online,
    sync,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
