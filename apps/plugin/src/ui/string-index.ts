import type { LibraryListingItem, VariableValues } from '@string-binder/contracts';
import {
  buildSequenceSource,
  searchHaystack,
  type SearchableVariable,
  type SequenceSource,
} from '@string-binder/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ORDER_INDEX_GZIP_BASE64 } from '../generated/order-index';
import type { UiBridge } from './bridge';
import { base64ToBytes, gunzipText, gzipText } from './codec';

export type StringEntry = SearchableVariable & { loaded: boolean; haystack: string };

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

function entry(item: LibraryListingItem, values?: Omit<VariableValues, 'key'>): StringEntry {
  const base = {
    ...item,
    en: values?.en ?? '',
    id: values?.id ?? '',
    description: values?.description ?? '',
    loaded: !!values,
  };
  return { ...base, haystack: searchHaystack(base) };
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

let orderTabs: Promise<Record<string, string[]>> | null = null;

function loadOrderTabs(): Promise<Record<string, string[]>> {
  orderTabs ??= gunzipText(base64ToBytes(ORDER_INDEX_GZIP_BASE64)).then(
    (text) => (JSON.parse(text) as { tabs: Record<string, string[]> }).tabs,
  );
  return orderTabs;
}

export type StringIndex = {
  status: IndexStatus;
  entries: ReadonlyMap<string, StringEntry>;
  list: readonly StringEntry[];
  collections: readonly string[];
  sequences: SequenceSource;
  version: number;
  refresh: () => void;
};

export function useStringIndex(bridge: UiBridge): StringIndex {
  const entries = useRef(new Map<string, StringEntry>());
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
    loadOrderTabs()
      .then(setTabs)
      .catch(() => setTabs({}));
  }, []);

  useEffect(
    () =>
      bridge.subscribe((message) => {
        switch (message.type) {
          case 'index:cached': {
            const restore = message.bytes ? decodeCache(message.bytes) : Promise.resolve([]);
            restore
              .catch(() => [] as StringEntry[])
              .then((cached) => {
                entries.current = new Map(cached.map((item) => [item.key, item]));
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
    () => buildSequenceSource({ orderedNames: tabs, variables: [...entries.current.values()] }),
    [tabs, listingVersion],
  );

  return { status, entries: entries.current, list, collections, sequences, version, refresh };
}
