import type {
  Catalog,
  CopyRecord,
  LibraryListingItem,
  VariableValues,
} from '@string-binder/contracts';
import {
  buildSequenceSource,
  productOf,
  productVocabulary,
  roleOf,
  type SearchableVariable,
  type SequenceSource,
} from '@string-binder/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ORDER_INDEX_GZIP_BASE64 } from '../generated/order-index';
import type { UiBridge } from './bridge';
import { catalogStore } from './catalog-store';
import { base64ToBytes, gunzipText } from './codec';
import { mergeIndex, registryCopyId } from './index-merge';

export type StringEntry = SearchableVariable & {
  loaded: boolean;
  /** Product (first name group), e.g. `investment`. */
  product: string;
  /** Readable legacy screen, e.g. `Investment Leaderboard › how to join · title`. */
  path: string;
  copyId: string;
  aliases: readonly string[];
  contexts: readonly { product: string; path: string; role: string }[];
  /** Role from the legacy sheets, else the key's suffix (`title`, `cta`, …). */
  role: string;
  /** Feature id or legacy section, for feature boosting and guessing. */
  feature: string;
  /** Legacy section name (sheet block), when known. */
  section: string;
  /** Defined in this file, not imported from a library. */
  local: boolean;
  /** Saved registry record behind this entry, when the registry knows it. */
  record?: CopyRecord;
  /** Key Apply binds; differs from `key` when the variable lags the saved wording. */
  bindKey?: string;
};

/** Legacy section and screen per variable name, from the generated order index. */
type LegacyPath = { section: string; screen: string; context: string; role: string };
type SearchMetadata = {
  copyId: string;
  canonicalName: string;
  role: string;
  aliases: string[];
  contexts: { product: string; path: string; role: string }[];
};
const searchMetadata = new Map<string, SearchMetadata>();
type OrderIndex = {
  metadata?: Record<string, [copyId: string, canonicalName: string, role: string]>;
  catalog?: Record<string, Pick<SearchMetadata, 'aliases' | 'contexts'>>;
  tabs: Record<string, string[]>;
  sections: string[];
  paths: Record<string, [section: number, screen: string, context: string, role: string]>;
};

const legacyPaths = new Map<string, LegacyPath>();

const words = (value: string) => value.replace(/[-_]+/gu, ' ').trim();

const keyPrefixes = new Map<string, RegExp>();

/** Fallback for strings the legacy sheets never had: the key without `gopay_<product>_`. */
function keyPath(name: string, product: string): string {
  const leaf = name.slice(name.lastIndexOf('/') + 1);
  let prefix = keyPrefixes.get(product);
  if (!prefix) {
    prefix = new RegExp(`^gopay_(${product.replace(/-/gu, '')}_)?`, 'u');
    keyPrefixes.set(product, prefix);
  }
  return words(leaf.replace(prefix, ''));
}

export function readablePath(name: string): string {
  const legacy = legacyPaths.get(name);
  if (!legacy) return keyPath(name, productOf(name));
  const screen = [legacy.screen, legacy.context].filter(Boolean).map(words).join(' › ');
  const place = [legacy.section, screen].filter(Boolean).join(' › ');
  return legacy.role ? `${place} · ${legacy.role}` : place;
}

export type IndexStatus =
  | { phase: 'starting' }
  | { phase: 'listing' }
  | { phase: 'ready' }
  | { phase: 'empty' };

/** Most keys one `index:resolve` may carry. */
const RESOLVE_BATCH = 100;

const baseProduct = (item: LibraryListingItem) => productOf(item.name, item.collection);

/** The machine-readable `Copy-Meta:` line is noise for search. */
const searchableDescription = (description: string) =>
  description.includes('Copy-Meta:')
    ? description.replace(/^Copy-Meta:.*$/gmu, '').trim()
    : description;

function entry(item: LibraryListingItem, values?: Omit<VariableValues, 'key'>): StringEntry {
  const metadata = searchMetadata.get(item.name);
  const copyId =
    values?.description.match(/^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}/u)?.[0] ?? metadata?.copyId ?? '';
  return {
    key: item.key,
    name: item.name,
    collection: item.collection,
    order: item.order,
    en: values?.en ?? '',
    id: values?.id ?? '',
    description: searchableDescription(values?.description ?? ''),
    loaded: !!values,
    product: baseProduct(item),
    path:
      baseProduct(item) === 'shared' && metadata && metadata.contexts.length > 1
        ? `Shared copy · ${metadata.contexts.length} contexts`
        : readablePath(item.name),
    copyId,
    aliases: [
      ...(metadata?.aliases ?? []),
      item.name.slice(item.name.lastIndexOf('/') + 1),
      item.key,
    ],
    contexts: metadata?.contexts ?? [],
    role: metadata?.role ?? roleOf([item.name.split('_').at(-1) ?? '']),
    section: legacyPaths.get(item.name)?.section ?? '',
    feature: legacyPaths.get(item.name)?.section ?? '',
    local: !!item.local,
  };
}

type RecordEntryCache = {
  key: string;
  base: StringEntry | undefined;
  products: Catalog['products'];
  value: StringEntry;
};
/**
 * Record entries only change when their record, key, base variable or the product
 * list changes. Records keep their identity until a new catalog arrives, so a
 * merge triggered by streaming values reuses almost every entry.
 */
let recordEntries = new WeakMap<CopyRecord, RecordEntryCache>();

function cachedRecordEntry(
  record: CopyRecord,
  key: string,
  products: Catalog['products'],
  base?: StringEntry,
): StringEntry {
  const hit = recordEntries.get(record);
  if (hit && hit.key === key && hit.base === base && hit.products === products) return hit.value;
  const value = recordEntry(record, key, products, base);
  recordEntries.set(record, { key, base, products, value });
  return value;
}

/** Search entry for a saved record, keeping the Figma variable it binds through. */
function recordEntry(
  record: CopyRecord,
  key: string,
  products: Catalog['products'],
  base?: StringEntry,
): StringEntry {
  const value = entry(
    {
      key,
      name: base?.name ?? record.platformKey,
      collection:
        base?.collection ??
        products.find((p) => p.id === record.product)?.displayName ??
        record.product,
      order: base?.order ?? Number.MAX_SAFE_INTEGER,
      local: base?.local,
    },
    { en: record.en, id: record.id, description: describe(record) },
  );
  value.product = record.product;
  value.copyId = record.copyId;
  value.record = record;
  const path = [record.context.feature, record.context.screen, record.context.context]
    .filter(Boolean)
    .map(words)
    .join(' › ');
  value.path = record.context.role ? `${path} · ${record.context.role}` : path;
  if (record.product === 'shared' && value.contexts.length > 1)
    value.path = `Shared copy · ${value.contexts.length} contexts`;
  value.aliases = [...new Set([...value.aliases, record.platformKey, ...record.aliases])];
  value.feature = record.context.feature || value.feature;
  return value;
}

/** What search reads from a record's description: `describeRecord` minus its hashed `Copy-Meta` line. */
function describe(record: CopyRecord): string {
  const { feature, screen, context, role, note } = record.context;
  return [
    record.copyId,
    [record.product, feature, screen, context, role].filter(Boolean).join(' › '),
    note ? `Note: ${note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

let orderIndex: Promise<OrderIndex> | null = null;

function loadOrderIndex(): Promise<OrderIndex> {
  orderIndex ??= gunzipText(base64ToBytes(ORDER_INDEX_GZIP_BASE64)).then((text) => {
    const index = JSON.parse(text) as OrderIndex;
    for (const [name, [copyId, canonicalName, role]] of Object.entries(index.metadata ?? {}))
      searchMetadata.set(name, {
        copyId,
        canonicalName,
        role,
        aliases: index.catalog?.[canonicalName]?.aliases ?? [],
        contexts: index.catalog?.[canonicalName]?.contexts ?? [],
      });
    for (const [name, [section, screen, context, role]] of Object.entries(index.paths ?? {}))
      legacyPaths.set(name, { section: index.sections[section] ?? '', screen, context, role });
    return index;
  });
  return orderIndex;
}

export type Product = { id: string; count: number };

const NO_PRODUCTS: Catalog['products'] = [];

export type StringIndex = {
  status: IndexStatus;
  /** Every known key, aliases included, → its canonical entry. */
  entries: ReadonlyMap<string, StringEntry>;
  /** Canonical searchable entries. */
  list: readonly StringEntry[];
  collections: readonly string[];
  sequences: SequenceSource;
  products: readonly Product[];
  /** Words describing each product, for guessing a frame's product. */
  vocabulary: ReadonlyMap<string, ReadonlySet<string>>;
  version: number;
  refresh: () => void;
  /**
   * Loads the values of library strings shown or bound but not loaded yet.
   * The library is never imported whole; only strings someone looks at are.
   */
  resolve: (keys: Iterable<string>) => void;
};

export function useStringIndex(bridge: UiBridge): StringIndex {
  // Figma variables (library + local), keyed by variable key. Registry data is joined on read.
  const figmaEntries = useRef(new Map<string, StringEntry>());
  const catalog = useRef<Catalog | null>(null);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<IndexStatus>({ phase: 'starting' });
  const [tabs, setTabs] = useState<Record<string, string[]>>({});
  // Bumped only when the set of variables changes; values arriving later do not reorder anything.
  const [listingVersion, setListingVersion] = useState(0);
  // Keys asked for once per listing, and those waiting for the next batched request.
  const requested = useRef(new Set<string>());
  const pending = useRef<string[]>([]);

  const bump = () => setVersion((value) => value + 1);

  useEffect(() => {
    loadOrderIndex()
      .then((index) => {
        // Entries made before the paths arrived get their readable path now.
        recordEntries = new WeakMap();
        for (const [key, item] of figmaEntries.current)
          figmaEntries.current.set(key, entry(item, item.loaded ? item : undefined));
        bump();
        setTabs(index.tabs);
      })
      .catch(() => setTabs({}));
  }, []);

  useEffect(() => {
    const store = catalogStore(bridge);
    const take = (next: Catalog) => {
      catalog.current = next;
      bump();
      setListingVersion((v) => v + 1);
    };
    if (store.get()) take(store.get()!);
    return store.subscribe(take);
  }, [bridge]);

  useEffect(() => {
    const stop = bridge.subscribe((message) => {
      switch (message.type) {
        case 'index:listing': {
          const values = new Map(message.values.map((value) => [value.key, value]));
          const next = new Map<string, StringEntry>();
          for (const item of message.listing) {
            const known = figmaEntries.current.get(item.key);
            const loaded = values.get(item.key) ?? (known?.loaded ? known : undefined);
            next.set(item.key, entry(item, loaded));
          }
          figmaEntries.current = next;
          requested.current.clear();
          bump();
          setListingVersion((value) => value + 1);
          setStatus(message.listing.length === 0 ? { phase: 'empty' } : { phase: 'ready' });
          return;
        }
        case 'index:local': {
          // Local variables changed (e.g. after Save and apply): replace only those.
          for (const [key, item] of figmaEntries.current)
            if (item.local) figmaEntries.current.delete(key);
          const values = new Map(message.values.map((value) => [value.key, value]));
          for (const item of message.listing)
            figmaEntries.current.set(item.key, entry(item, values.get(item.key)));
          bump();
          setListingVersion((value) => value + 1);
          return;
        }
        case 'index:values': {
          let changed = false;
          for (const values of message.values) {
            const known = figmaEntries.current.get(values.key);
            if (!known) continue;
            figmaEntries.current.set(values.key, entry(known, values));
            changed = true;
          }
          if (changed) bump();
          return;
        }
        default:
          return;
      }
    });
    bridge.send({ type: 'index:sync' });
    return stop;
  }, [bridge]);

  const refresh = useCallback(() => {
    setStatus({ phase: 'listing' });
    bridge.send({ type: 'index:sync' });
  }, [bridge]);

  const merged = useMemo(
    () =>
      mergeIndex(figmaEntries.current.values(), catalog.current, (record, key, base) =>
        cachedRecordEntry(record, key, catalog.current?.products ?? NO_PRODUCTS, base),
      ),
    [version],
  );
  // Keys are stable while values arrive, so ordering structures rebuild only on listing changes.
  const latest = useRef(merged);
  latest.current = merged;

  const resolve = useCallback(
    (keys: Iterable<string>) => {
      const queued = pending.current.length;
      for (const key of keys) {
        if (requested.current.has(key) || latest.current.entries.get(key)?.loaded) continue;
        if (!figmaEntries.current.has(key)) continue;
        requested.current.add(key);
        pending.current.push(key);
      }
      if (queued || !pending.current.length) return;
      // Rows rendering in the same pass ask together.
      queueMicrotask(() => {
        const keys = pending.current;
        pending.current = [];
        for (let start = 0; start < keys.length; start += RESOLVE_BATCH)
          bridge.send({ type: 'index:resolve', keys: keys.slice(start, start + RESOLVE_BATCH) });
      });
    },
    [bridge],
  );

  const listed = useMemo(() => latest.current, [listingVersion, tabs]);
  const collections = useMemo(
    () => [...new Set(merged.list.map((item) => item.collection))],
    [merged],
  );
  const sequences = useMemo(() => {
    const source = buildSequenceSource({
      orderedNames: tabs,
      variables: listed.list.map((item) => ({
        ...item,
        aliases: item.aliases.filter((alias) => alias.includes('/')),
      })),
    });
    // Layers bound through an alias (an older or mirrored variable) anchor like the canonical key.
    const positions = new Map(source.positions);
    for (const [key, item] of listed.entries)
      if (key !== item.key && !positions.has(key)) {
        const at = source.positions.get(item.key);
        if (at) positions.set(key, at);
      }
    return { sequences: source.sequences, positions };
  }, [tabs, listed]);
  const products = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of listed.list)
      if (item.product) counts.set(item.product, (counts.get(item.product) ?? 0) + 1);
    return [...counts]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [listed]);
  const vocabulary = useMemo(
    () =>
      productVocabulary(
        listed.list.map((item) => ({
          name: `${item.product}/${item.name.slice(item.name.lastIndexOf('/') + 1)}`,
          section: item.section,
        })),
      ),
    [listed],
  );

  return {
    status,
    entries: merged.entries,
    list: merged.list,
    collections,
    sequences,
    products,
    vocabulary,
    version,
    refresh,
    resolve,
  };
}

/** Copy ID a pick or binding key refers to, for keys that never reached the index. */
export { registryCopyId };
