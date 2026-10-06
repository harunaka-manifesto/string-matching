import type { LibraryListingItem, VariableValues } from '@string-binder/contracts';
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

/** Fallback for strings the legacy sheets never had: the key without `gopay_<product>_`. */
function keyPath(name: string, product: string): string {
  const leaf = name.slice(name.lastIndexOf('/') + 1);
  return words(leaf.replace(new RegExp(`^gopay_(${product.replace(/-/gu, '')}_)?`, 'u'), ''));
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

const baseProduct = (item: LibraryListingItem) => productOf(item.name, item.collection);

function entry(item: LibraryListingItem, values?: Omit<VariableValues, 'key'>): StringEntry {
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
  };
  return { ...base, fields: normalizedFields(base) };
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

export type StringIndex = {
  status: IndexStatus;
  entries: ReadonlyMap<string, StringEntry>;
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
  const entries = useRef(new Map<string, StringEntry>());
  const registryEntries=useRef(new Map<string,StringEntry>());
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<IndexStatus>({ phase: 'starting' });
  const [tabs, setTabs] = useState<Record<string, string[]>>({});
  const sinceSave = useRef(0);
  // Bumped only when the set of variables changes; values arriving later do not reorder anything.
  const [listingVersion, setListingVersion] = useState(0);

  const bump = () => setVersion((value) => value + 1);
  const save = useCallback(async () => {
    sinceSave.current = 0;
    bridge.send({ type: 'index:save', bytes: await encodeCache(entries.current.values()) });
  }, [bridge]);

  useEffect(() => {
    loadOrderIndex()
      .then((index) => {
        // Entries made before the paths arrived get their readable path now.
        for (const [key, item] of entries.current)
          entries.current.set(key, entry(item, item.loaded ? item : undefined));
        bump();
        setTabs(index.tabs);
      })
      .catch(() => setTabs({}));
  }, []);

  useEffect(
    () =>
      bridge.subscribe((message) => {
        switch (message.type) {
          case 'registry:catalog': {
            const identities=new Set(message.catalog.records.map(r=>r.copyId));
            for(const [key,value] of entries.current)if(key.startsWith('registry:')||identities.has(value.copyId))entries.current.delete(key);
            registryEntries.current.clear();
            for(const r of message.catalog.records.filter(r=>r.status==='active'||r.status==='deprecated')){
              const value=entry({key:`registry:${r.copyId}:${r.revision}`,name:r.platformKey,collection:message.catalog.products.find(p=>p.id===r.product)?.displayName??r.product,order:entries.current.size},{en:r.en,id:r.id,description:describeRecord(r)});
              value.product=r.product;value.path=[r.context.feature,r.context.screen,r.context.context,r.context.role].filter(Boolean).join(' › ');value.aliases=r.aliases;value.fields=normalizedFields(value);registryEntries.current.set(value.key,value);entries.current.set(value.key,value);
            }
            bump();setListingVersion(v=>v+1);return;
          }
          case 'index:cached': {
            const restore = message.bytes ? decodeCache(message.bytes) : Promise.resolve([]);
            restore
              .catch(() => [] as StringEntry[])
              .then((cached) => {
                entries.current = new Map(cached.map((item) => [item.key, item]));
                const ids=new Set([...registryEntries.current.values()].map(v=>v.copyId));for(const [key,value] of entries.current)if(ids.has(value.copyId)||key.startsWith('registry:'))entries.current.delete(key);for(const [key,value] of registryEntries.current)entries.current.set(key,value);
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
              const known = entries.current.get(item.key);
              next.set(item.key, known?.loaded ? entry(item, known) : entry(item));
            }
            entries.current = next;
            const ids=new Set([...registryEntries.current.values()].map(v=>v.copyId));for(const [key,value] of entries.current)if(ids.has(value.copyId))entries.current.delete(key);for(const [key,value] of registryEntries.current)entries.current.set(key,value);
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
          case 'index:values': {
            for (const values of message.values) {
              const known = entries.current.get(values.key);
              if (known) entries.current.set(values.key, entry(known, values));
            }
            bump();
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

  const list = useMemo(() => [...entries.current.values()], [version]);
  const collections = useMemo(() => [...new Set(list.map((item) => item.collection))], [list]);
  const sequences = useMemo(
    () =>
      buildSequenceSource({
        orderedNames: tabs,
        variables: [...entries.current.values()].map((item) => ({
          ...item,
          aliases: item.aliases.filter((alias) => alias.includes('/')),
        })),
      }),
    [tabs, listingVersion],
  );
  const products = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of entries.current.values())
      if (item.product) counts.set(item.product, (counts.get(item.product) ?? 0) + 1);
    return [...counts]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [tabs, listingVersion]);
  const vocabulary = useMemo(
    () =>
      productVocabulary(
        [...entries.current.values()].map((item) => ({
          name: `${item.product}/${item.name}`,
          section: legacyPaths.get(item.name)?.section,
        })),
      ),
    [tabs, listingVersion],
  );

  return {
    status,
    entries: entries.current,
    list,
    collections,
    sequences,
    products,
    vocabulary,
    version,
    refresh,
  };
}
