import { randomUUID } from 'node:crypto';
import { beforeEach, it, expect, vi } from 'vitest';
import { readPrivate, writePrivate, writeStorage } from '../src/main/private-storage';
let stored: Map<string, unknown>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('figma', {
    clientStorage: {
      keysAsync: async () => [...stored.keys()],
      getAsync: async (k: string) => stored.get(k),
      deleteAsync: async (k: string) => stored.delete(k),
      setAsync: async (k: string, v: unknown) => {
        const bytes = (x: unknown) =>
          x instanceof Uint8Array ? x.byteLength : Buffer.byteLength(JSON.stringify(x));
        const total =
          [...stored].filter(([key]) => key !== k).reduce((n, [, value]) => n + bytes(value), 0) +
          bytes(v);
        if (total > 5_000_000) throw new Error('Figma quota exceeded');
        stored.set(k, v);
      },
    },
  });
});
it('compresses a 20,000-record catalog and preserves exact Unicode/whitespace', async () => {
  const catalog = {
    seq: 42,
    records: Array.from({ length: 20000 }, (_, i) => ({
      copyId: randomUUID(),
      en: '  Hello 世界 🚀\n' + i + ' ' + 'copy text '.repeat(20),
      id: ' Halo 世界 🚀\n' + i + ' ' + 'kata kata '.repeat(20),
      context: { screen: 'checkout', note: 'Preserve whitespace' },
    })),
  };
  expect(Buffer.byteLength(JSON.stringify(catalog))).toBeGreaterThan(5_000_000);
  await writePrivate('registry:catalog:test', catalog, false);
  expect(stored.get('registry:catalog:test')).toBeInstanceOf(Uint8Array);
  expect(await readPrivate('registry:catalog:test')).toEqual(catalog);
});
it('evicts disposable caches before durable operations and never evicts drafts', async () => {
  await writePrivate('registry:drafts:document', { frameId: 'frame', translation: 'Keep me' });
  await writeStorage('registry:catalog:test', new Uint8Array(2_000_000), false);
  await writeStorage('string-index:v1', new Uint8Array(2_000_000), false);
  await writeStorage('registry:run', new Uint8Array(1_500_000));
  expect(await readPrivate('registry:drafts:document')).toEqual({
    frameId: 'frame',
    translation: 'Keep me',
  });
  expect(stored.has('registry:run')).toBe(true);
  expect(stored.has('registry:catalog:test') && stored.has('string-index:v1')).toBe(false);
});
it('refuses an oversized durable write and leaves existing drafts recoverable', async () => {
  await writePrivate('registry:drafts:document', { requestId: 'saved-request' });
  await expect(writeStorage('registry:run', new Uint8Array(5_000_001))).rejects.toThrow(
    'Private storage is full',
  );
  expect(await readPrivate('registry:drafts:document')).toEqual({ requestId: 'saved-request' });
});
it('reads the previous plain storage format during an upgrade', async () => {
  stored.set('registry:drafts:old', { frameId: 'old' });
  expect(await readPrivate('registry:drafts:old')).toEqual({ frameId: 'old' });
});
