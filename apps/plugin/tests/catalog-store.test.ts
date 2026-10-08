import type {
  Catalog,
  CopyRecord,
  PluginToUiMessage,
  UiToPluginMessage,
} from '@string-binder/contracts';
import { expect, it, vi } from 'vitest';
import type { UiBridge } from '../src/ui/bridge';
import { catalogStore } from '../src/ui/catalog-store';
import { gzipText } from '../src/ui/codec';

const id = (n: number) => `cp_01K0000000E00R00000000000${n}`;
const record = (n: number, patch: Partial<CopyRecord> = {}): CopyRecord => ({
  copyId: id(n),
  platformKey: `key_${n}`,
  revision: 1,
  en: `Text ${n}`,
  id: `Teks ${n}`,
  product: 'investment',
  context: { feature: '', screen: '', context: '', role: 'text', note: '' },
  status: 'active',
  aliases: [],
  ...patch,
});
const saved: Catalog = {
  seq: 5,
  records: [record(1, { status: 'merged', mergedInto: id(2) }), record(2), record(3)],
  products: [{ id: 'investment', displayName: 'Investment', keyToken: 'inv', legacyGroups: [] }],
  mappings: [],
};

/** A fake plugin controller: answers registry reads and records what the store sends. */
function fakeBridge(changes: unknown) {
  const listeners = new Set<(m: PluginToUiMessage) => void>();
  const sent: UiToPluginMessage[] = [];
  const emit = (m: PluginToUiMessage) => listeners.forEach((l) => l(m));
  const bridge: UiBridge = {
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    send: (m) => {
      sent.push(m);
      if (m.type === 'workflow' && m.action === 'registry:fetch')
        queueMicrotask(() =>
          emit({
            type: 'workflow:result',
            operationId: m.operationId,
            data: new TextEncoder().encode(JSON.stringify(changes)),
          }),
        );
    },
  };
  return { bridge, sent, emit };
}

const answered = async (sent: UiToPluginMessage[]) => {
  // A failed full download is retried with backoff before the store gives up.
  await expect
    .poll(() => sent.some((m) => m.type === 'catalog:answer'), { timeout: 10000 })
    .toBe(true);
  return sent.find((m) => m.type === 'catalog:answer') as Extract<
    UiToPluginMessage,
    { type: 'catalog:answer' }
  >;
};

it('restores the saved catalog and answers queries with only the records asked for', async () => {
  const { bridge, sent, emit } = fakeBridge({ seq: 5, events: [], more: false });
  const store = catalogStore(bridge);
  emit({ type: 'catalog:cached', bytes: await gzipText(JSON.stringify(saved)) });
  emit({ type: 'catalog:query', queryId: 'q1', copyIds: [id(1)], fresh: false });
  const answer = await answered(sent);
  // The merged record and the record it was merged into; never the whole catalog.
  expect(answer.records.map((r) => r.copyId)).toEqual([id(1), id(2)]);
  expect(answer.products).toHaveLength(1);
  expect(answer.seq).toBe(5);
  expect(store.get()?.records).toHaveLength(3);
});

it('applies registry changes on top of the saved catalog and saves the result', async () => {
  const { bridge, sent, emit } = fakeBridge({
    seq: 7,
    more: false,
    events: [{ type: 'copy', record: record(3, { revision: 2, en: 'Edited' }) }],
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const store = catalogStore(bridge);
  emit({ type: 'catalog:cached', bytes: await gzipText(JSON.stringify(saved)) });
  const next = await store.sync();
  expect(next.seq).toBe(7);
  expect(next.records.find((r) => r.copyId === id(3))?.en).toBe('Edited');
  expect(store.online()).toBe(true);
  // Saving waits a moment so back-to-back syncs write once.
  expect(sent.some((m) => m.type === 'catalog:save')).toBe(false);
  await vi.advanceTimersByTimeAsync(3000);
  vi.useRealTimers();
  await expect.poll(() => sent.some((m) => m.type === 'catalog:save')).toBe(true);
});

it('answers with an error when there is no catalog at all and the registry is unreachable', async () => {
  const { bridge, sent, emit } = fakeBridge(null);
  bridge.send = (m) => {
    sent.push(m);
    if (m.type === 'workflow')
      queueMicrotask(() =>
        emit({
          type: 'workflow:error',
          operationId: m.operationId,
          code: 'UNAVAILABLE',
          message: 'Registry unavailable.',
        }),
      );
  };
  catalogStore(bridge);
  emit({ type: 'catalog:cached', bytes: null });
  emit({ type: 'catalog:query', queryId: 'q2', copyIds: [id(2)], fresh: true });
  const answer = await answered(sent);
  expect(answer.error).toBeTruthy();
}, 15000);
