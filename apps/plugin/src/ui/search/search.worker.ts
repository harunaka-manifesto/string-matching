import type { SearchIndex } from '@string-binder/domain';
import { indexDocs, runSearch } from './engine';
import type { FromSearchWorker, SearchDoc, ToSearchWorker } from './protocol';

/**
 * Ranks strings off the UI thread. Ranking 20k strings on every keystroke froze
 * the plugin (and Figma with it); the index here answers in a few milliseconds
 * and the UI only ever renders the top results.
 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToSearchWorker>) => void) | null;
  postMessage: (message: FromSearchWorker) => void;
};

/** Arrived values are re-indexed once nobody has typed for this long. */
const PATCH_DELAY_MS = 800;

const docs = new Map<string, SearchDoc>();
let index: SearchIndex | null = null;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

function rebuildLater() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, PATCH_DELAY_MS);
}

function rebuild(): SearchIndex {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = null;
  return (index = indexDocs([...docs.values()]));
}

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case 'docs':
      docs.clear();
      for (const doc of data.docs) docs.set(doc.key, doc);
      rebuild();
      return;
    case 'patch':
      for (const doc of data.docs) docs.set(doc.key, doc);
      rebuildLater();
      return;
    case 'search': {
      const started = performance.now();
      const result = runSearch(index ?? rebuild(), data.request);
      scope.postMessage({
        type: 'results',
        seq: data.seq,
        result,
        ms: performance.now() - started,
      });
      // A rebuild between keystrokes would hold up the next one.
      if (rebuildTimer) rebuildLater();
      return;
    }
  }
};
