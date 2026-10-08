import type { SearchResult } from '@string-binder/domain';

/** What the search worker needs of a string: copies of plain values, no records or maps. */
export type SearchDoc = {
  key: string;
  name: string;
  order: number;
  product: string;
  loaded: boolean;
  en: string;
  id: string;
  path: string;
  description: string;
  aliases: readonly string[];
  copyId: string;
  /** Role ranking reads; the key's suffix when empty. */
  role: string;
  feature: string;
  contexts: readonly { product: string; path: string; role: string }[];
};

export type SearchRequest = {
  query: string;
  scope: string | null;
  feature: string | null;
  used: readonly string[];
  context: readonly string[];
  layerText: string;
  role: string;
  nearby: readonly string[];
  currentKey: string | null;
  limit: number;
  related: boolean;
};

export type ToSearchWorker =
  /** Replaces every string, e.g. after the library listing or catalog changed. */
  | { type: 'docs'; docs: SearchDoc[] }
  /** Values that arrived for known strings; searched by them a moment later. */
  | { type: 'patch'; docs: SearchDoc[] }
  | { type: 'search'; seq: number; request: SearchRequest };

export type FromSearchWorker = { type: 'results'; seq: number; result: SearchResult; ms: number };
