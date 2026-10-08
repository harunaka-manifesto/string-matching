import {
  createSearchIndex,
  SHARED_PRODUCT,
  normalizedFields,
  roleOf,
  type RankFields,
  type SearchIndex,
  type SearchResult,
} from '@string-binder/domain';
import type { SearchDoc, SearchRequest } from './protocol';

/** Copy read through the product contexts it is used in: their screens and role. */
function contextFields(doc: SearchDoc, contexts: SearchDoc['contexts']): RankFields {
  const base = doc.role ? roleOf([doc.role]) : roleOf([doc.name.split('_').at(-1) ?? '']);
  return normalizedFields({
    ...doc,
    path: contexts.map((context) => context.path).join(' '),
    role: contexts.find((context) => context.role !== 'text')?.role ?? base,
  });
}

const plainFields = (doc: SearchDoc) => normalizedFields({ ...doc, role: doc.role || undefined });
const ownContexts = (doc: SearchDoc) =>
  doc.contexts.filter((context) => context.product === doc.product);

// Docs keep their identity until their values change, so a rebuild after a
// patch only normalizes the strings that changed.
const fieldCache = new WeakMap<SearchDoc, RankFields>();
const scopedCache = new WeakMap<SearchDoc, Map<string | null, RankFields | null>>();

/**
 * Product copy only shows in its own product and in All products, so its own
 * product's contexts go straight into the word index.
 */
function fieldsOf(doc: SearchDoc): RankFields {
  let fields = fieldCache.get(doc);
  if (!fields) {
    const own = doc.product === SHARED_PRODUCT ? [] : ownContexts(doc);
    fields = own.length ? contextFields(doc, own) : plainFields(doc);
    fieldCache.set(doc, fields);
  }
  return fields;
}

/** Shared copy reads as the product it is used in; All products reads every context. */
function scopedFieldsOf(doc: SearchDoc, product: string | null): RankFields | null {
  if (!doc.contexts.length) return null;
  const shared = doc.product === SHARED_PRODUCT;
  if (!shared && product) return null;
  let byProduct = scopedCache.get(doc);
  if (!byProduct) scopedCache.set(doc, (byProduct = new Map()));
  let fields = byProduct.get(product);
  if (fields === undefined) {
    const contexts = doc.contexts.filter((context) => !product || context.product === product);
    if (!contexts.length) fields = null;
    // The same contexts read the same: one indexed row serves both scopes.
    else if (!shared && contexts.length === ownContexts(doc).length) fields = fieldsOf(doc);
    else if (product && contexts.length === doc.contexts.length) fields = scopedFieldsOf(doc, null);
    else fields = contextFields(doc, contexts);
    byProduct.set(product, fields);
  }
  return fields;
}

export const indexDocs = (docs: readonly SearchDoc[]): SearchIndex =>
  createSearchIndex(docs, fieldsOf, scopedFieldsOf);

export function runSearch(index: SearchIndex, request: SearchRequest): SearchResult {
  const { query, used, nearby, ...options } = request;
  return index.search(query, { ...options, used: new Set(used), nearby: new Set(nearby) });
}
