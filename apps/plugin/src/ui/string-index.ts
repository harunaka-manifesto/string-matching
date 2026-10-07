import type {
  Catalog,
  CopyRecord,
  LibraryListingItem,
  VariableValues,
} from '@string-binder/contracts';
import {
  describeRecord,
  buildSequenceSource,
  normalizedFields,
  productOf,
  productVocabulary,
  roleOf,
  type RankFields,
  type SearchableVariable,
  type SequenceSource,
} from '@string-binder/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ORDER_INDEX_GZIP_BASE64 } from '../generated/order-index';
import type { UiBridge } from './bridge';
import { base64ToBytes, gunzipText, gzipText } from './codec';
import { mergeIndex, registryCopyId } from './index-merge';

export type StringEntry = SearchableVariable & {
  loaded: boolean;
  /** Product (first name group), e.g. `investment`. */
  product: string;
  /** Readable legacy screen, e.g. `Investment Leaderboard › how to join · title`. */
  path: string;
  fields: RankFields;
  copyId: string;
  aliases: readonly string[];
  contexts: readonly { product: string; path: string; role: string }[];
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
  | { phase: 'importing'; done: number; total: number }
  | { phase: 'ready'; failed: number }
  | { phase: 'empty' };

type CacheRow = [
  key: string,
  name: string,
  collection: string,
  order: number,
  en: string,
  id: string,
  description: string,
];
type CacheFile = { v: 1; rows: CacheRow[] };

/** Save progress every N imported values so a closed plugin resumes where it stopped. */
const SAVE_EVERY = 2000;
/** Streaming values re-merge the whole index; coalesce them to at most one merge per interval. */
const MERGE_INTERVAL_MS = 250;

const baseProduct = (item: LibraryListingItem) => productOf(item.name, item.collection);

function entry(
  item: LibraryListingItem,
  values?: Omit<VariableValues, 'key'>,
  withFields = true,
): StringEntry {
  const metadata = searchMetadata.get(item.name);
  const copyId =
    values?.description.match(/^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}/u)?.[0] ?? metadata?.copyId ?? '';
  const base = {
    key: item.key,
    name: item.name,
    collection: item.collection,
    order: item.order,
    en: values?.en ?? '',
    id: values?.id ?? '',
    description: values?.description ?? '',
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
  // Normalizing is the costly part; callers that overwrite the fields skip it here.
  return { ...base, fields: withFields ? normalizedFields(base) : EMPTY_FIELDS };
}

const EMPTY_FIELDS = normalizedFields({ en: '', id: '', name: '', path: '' });

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
    { en: record.en, id: record.id, description: describeRecord(record) },
    false,
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
  value.fields = normalizedFields({ ...value, role: record.context.role || undefined });
  return value;
}

async function encodeCache(entries: Iterable<StringEntry>): Promise<Uint8Array> {
  const rows: CacheRow[] = [];
  for (const item of entries)
    if (item.loaded)
      rows.push([
        item.key,
        item.name,
        item.collection,
        item.order,
        item.en,
        item.id,
        item.description,
      ]);
  return gzipText(JSON.stringify({ v: 1, rows } satisfies CacheFile));
}

async function decodeCache(bytes: Uint8Array): Promise<StringEntry[]> {
  const file = JSON.parse(await gunzipText(bytes)) as CacheFile;
  if (file.v !== 1) return [];
  return file.rows.map(([key, name, collection, order, en, id, description]) =>
    entry({ key, name, collection, order }, { en, id, description }),
  );
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
};

export function useStringIndex(bridge: UiBridge): StringIndex {
  // Figma variables (library + local), keyed by variable key. Registry data is joined on read.
  const figmaEntries = useRef(new Map<string, StringEntry>());
  const catalog = useRef<Catalog | null>(null);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<IndexStatus>({ phase: 'starting' });
  const [tabs, setTabs] = useState<Record<string, string[]>>({});
  const sinceSave = useRef(0);
  // Bumped only when the set of variables changes; values arriving later do not reorder anything.
  const [listingVersion, setListingVersion] = useState(0);

  const bump = () => setVersion((value) => value + 1);
  const bumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpSoon = () => {
    bumpTimer.current ??= setTimeout(() => {
      bumpTimer.current = null;
      bump();
    }, MERGE_INTERVAL_MS);
  };
  useEffect(() => () => clearTimeout(bumpTimer.current ?? undefined), []);
  const save = useCallback(async () => {
    sinceSave.current = 0;
    bridge.send({ type: 'index:save', bytes: await encodeCache(figmaEntries.current.values()) });
  }, [bridge]);

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

  useEffect(
    () =>
      bridge.subscribe((message) => {
        switch (message.type) {
          case 'registry:catalog':
            catalog.current = message.catalog;
            bump();
            setListingVersion((v) => v + 1);
            return;
          case 'index:cached': {
            const restore = message.bytes ? decodeCache(message.bytes) : Promise.resolve([]);
            restore
              .catch(() => [] as StringEntry[])
              .then((cached) => {
                figmaEntries.current = new Map(cached.map((item) => [item.key, item]));
                bump();
                setListingVersion((value) => value + 1);
                setStatus({ phase: 'listing' });
                bridge.send({ type: 'index:sync', knownKeys: cached.map((item) => item.key) });
              });
            return;
          }
          case 'index:listing': {
            const next = new Map<string, StringEntry>();
            for (const item of message.listing) {
              const known = figmaEntries.current.get(item.key);
              next.set(item.key, known?.loaded ? entry(item, known) : entry(item));
            }
            figmaEntries.current = next;
            bump();
            setListingVersion((value) => value + 1);
            setStatus(
              message.listing.length === 0
                ? { phase: 'empty' }
                : message.toImport
                  ? { phase: 'importing', done: 0, total: message.toImport }
                  : { phase: 'ready', failed: 0 },
            );
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
            for (const values of message.values) {
              const known = figmaEntries.current.get(values.key);
              if (known) figmaEntries.current.set(values.key, entry(known, values));
            }
            bumpSoon();
            if (message.total)
              setStatus({ phase: 'importing', done: message.done, total: message.total });
            sinceSave.current += message.values.length;
            if (sinceSave.current >= SAVE_EVERY) void save();
            return;
          }
          case 'index:synced':
            setStatus((current) =>
              current.phase === 'empty' ? current : { phase: 'ready', failed: message.failed },
            );
            void save();
            return;
          default:
            return;
        }
      }),
    [bridge, save],
  );

  const refresh = useCallback(() => {
    setStatus({ phase: 'listing' });
    bridge.send({ type: 'index:sync', knownKeys: [] });
  }, [bridge]);

  const merged = useMemo(
    () =>
      mergeIndex(figmaEntries.current.values(), catalog.current, (record, key, base) =>
        cachedRecordEntry(record, key, catalog.current?.products ?? NO_PRODUCTS, base),
      ),
    [version],
  );
  // Keys are stable while values stream in, so ordering structures rebuild only on listing changes.
  const latest = useRef(merged);
  latest.current = merged;
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
  };
}

/** Copy ID a pick or binding key refers to, for keys that never reached the index. */
export { registryCopyId };
