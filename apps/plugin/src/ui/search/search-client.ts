import { roleOf, type SearchIndex, type SearchResult } from '@string-binder/domain';
import type { StringEntry } from '../string-index';
import { indexDocs, runSearch } from './engine';
import type { FromSearchWorker, SearchDoc, SearchRequest, ToSearchWorker } from './protocol';
import SearchWorker from './search.worker?worker&inline';

/** Role search ranks by: the record's role for saved copy, else the variable's. */
const rankRole = (item: StringEntry) => (item.record ? item.record.context.role : item.role) ?? '';

/** Role a result shows, as ranking normalizes it. */
export const displayRole = (item: StringEntry) => {
  const role = rankRole(item);
  return role ? roleOf([role]) : roleOf([item.name.split('_').at(-1) ?? '']);
};

function docOf(item: StringEntry): SearchDoc {
  return {
    key: item.key,
    name: item.name,
    order: item.order,
    product: item.product,
    loaded: item.loaded,
    en: item.en,
    id: item.id,
    path: item.path,
    description: item.description,
    aliases: item.aliases,
    copyId: item.copyId,
    role: rankRole(item),
    feature: item.feature,
    contexts: item.contexts,
  };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a === b || (a.length === b.length && a.every((value, i) => value === b[i]));

function sameDoc(a: SearchDoc, b: SearchDoc): boolean {
  return (
    a.name === b.name &&
    a.order === b.order &&
    a.product === b.product &&
    a.loaded === b.loaded &&
    a.en === b.en &&
    a.id === b.id &&
    a.path === b.path &&
    a.description === b.description &&
    a.copyId === b.copyId &&
    a.role === b.role &&
    a.feature === b.feature &&
    sameList(a.aliases, b.aliases) &&
    (a.contexts === b.contexts || JSON.stringify(a.contexts) === JSON.stringify(b.contexts))
  );
}

/** More changed values than this re-send everything; the worker rebuilds either way. */
const MAX_PATCH = 2000;

type Pending = (result: SearchResult | null) => void;

/**
 * One search worker for the plugin session. The string list is sent when it
 * changes (as a small patch when only values arrived), so search opens warm.
 */
function createClient() {
  let worker: Worker | null = null;
  // Without workers (old runtimes, tests) the same index runs here.
  let local: { docs: Map<string, SearchDoc>; index: SearchIndex | null } | null = null;
  try {
    worker = new SearchWorker();
  } catch {
    local = { docs: new Map(), index: null };
  }
  let sent = new Map<string, SearchDoc>();
  let seq = 0;
  const waiting = new Map<number, Pending>();

  const post = (message: ToSearchWorker) => {
    if (worker) return worker.postMessage(message);
    if (!local || message.type === 'search') return;
    if (message.type === 'docs') local.docs.clear();
    for (const doc of message.docs) local.docs.set(doc.key, doc);
    local.index = null;
  };

  worker?.addEventListener('message', ({ data }: MessageEvent<FromSearchWorker>) => {
    waiting.get(data.seq)?.(data.result);
    waiting.delete(data.seq);
  });

  return {
    sync(list: readonly StringEntry[]) {
      const next = new Map<string, SearchDoc>();
      const changed: SearchDoc[] = [];
      let added = 0;
      for (const item of list) {
        const doc = docOf(item);
        next.set(doc.key, doc);
        const before = sent.get(doc.key);
        if (!before) added += 1;
        if (!before || !sameDoc(before, doc)) changed.push(doc);
      }
      // New or removed strings must be findable now; only value fills wait for a pause.
      const reshaped = added > 0 || sent.size !== next.size;
      if (reshaped || changed.length > MAX_PATCH) post({ type: 'docs', docs: [...next.values()] });
      else if (changed.length) post({ type: 'patch', docs: changed });
      sent = next;
    },
    /** Ranks `request`; `null` when a newer search replaced it before it finished. */
    search(request: SearchRequest): Promise<SearchResult | null> {
      if (!worker) {
        local!.index ??= indexDocs([...local!.docs.values()]);
        return Promise.resolve(runSearch(local!.index, request));
      }
      seq += 1;
      // Only the newest query matters.
      for (const pending of waiting.values()) pending(null);
      waiting.clear();
      return new Promise((resolve) => {
        waiting.set(seq, resolve);
        post({ type: 'search', seq, request });
      });
    },
  };
}

let client: ReturnType<typeof createClient> | null = null;
export const searchClient = () => (client ??= createClient());
