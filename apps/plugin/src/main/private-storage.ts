import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';

// Figma gives the entire plugin 5MB. Drafts/manifests take priority over disposable catalogs.
const BUDGET = 4_800_000;
const disposable = (key: string) => key.startsWith('registry:catalog') || key === 'string-index:v1';
const size = (key: string, value: unknown) =>
  strToU8(key).byteLength +
  (value instanceof Uint8Array
    ? value.byteLength
    : strToU8(JSON.stringify(value) ?? 'null').byteLength);
let writes: Promise<void> = Promise.resolve();
export async function readPrivate<T>(key: string): Promise<T | undefined> {
  const stored = await figma.clientStorage.getAsync(key);
  return stored instanceof Uint8Array
    ? (JSON.parse(strFromU8(gunzipSync(stored))) as T)
    : (stored as T | undefined);
}
export function writeStorage(key: string, value: unknown, durable = true): Promise<void> {
  const task = async () => {
    const keys = await figma.clientStorage.keysAsync();
    const entries = await Promise.all(
      keys
        .filter((k) => k !== key)
        .map(async (k) => ({ key: k, bytes: size(k, await figma.clientStorage.getAsync(k)) })),
    );
    let used = entries.reduce((n, e) => n + e.bytes, 0) + size(key, value);
    for (const e of entries.filter((e) => disposable(e.key)))
      if (used > BUDGET) {
        await figma.clientStorage.deleteAsync(e.key);
        used -= e.bytes;
      }
    if (used > BUDGET) {
      if (!durable) return;
      throw new Error(
        'Private storage is full. Finish existing drafts or sync operations before saving another. Keep the existing request ID to recover any submitted copy.',
      );
    }
    try {
      await figma.clientStorage.setAsync(key, value);
    } catch (error) {
      if (durable) throw error;
    }
  };
  const result = writes.then(task);
  writes = result.catch(() => {});
  return result;
}
export function writePrivate(key: string, value: unknown, durable = true): Promise<void> {
  return writeStorage(
    key,
    gzipSync(strToU8(JSON.stringify(value)), { level: 6, mtime: 0 }),
    durable,
  );
}
