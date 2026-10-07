import type { Catalog, CopyRecord } from '@string-binder/contracts';
import type { StringEntry } from './string-index';

export type MergedIndex = {
  /** Every key that can appear on a layer or in a pick, aliases included, → its canonical entry. */
  entries: Map<string, StringEntry>;
  /** Canonical, searchable entries: one per saved identity plus unregistered library strings. */
  list: StringEntry[];
};

const SEARCHABLE = new Set<CopyRecord['status']>(['active', 'deprecated']);

/** Key used for a saved record that no Figma variable carries at its latest wording yet. */
export const registryKey = (copyId: string) => `registry:${copyId}`;

/** `registry:<copyId>` and the older `registry:<copyId>:<revision>` both name the record. */
export function registryCopyId(key: string): string | null {
  return key.startsWith('registry:') ? (key.split(':')[1] ?? null) : null;
}

function current(entry: StringEntry, record: CopyRecord): boolean {
  return entry.loaded && entry.en === record.en && entry.id === record.id;
}

/**
 * Joins Figma variables (library and local) with the saved registry.
 *
 * Each saved identity gets one entry. Its key is stable while values load: the
 * published library variable, else a local mirror, else `registry:<copyId>`.
 * Every other variable of that identity becomes an alias, so layers bound to
 * it still resolve, show their copy and anchor the legacy sequence.
 *
 * `bindKey` is what Apply binds: a variable already showing the latest wording
 * (no new local variable needed), else `registry:<copyId>`, which the plugin
 * materializes from the saved record.
 */
export function mergeIndex(
  figma: Iterable<StringEntry>,
  catalog: Catalog | null,
  fromRecord: (record: CopyRecord, key: string, base?: StringEntry) => StringEntry,
): MergedIndex {
  const entries = new Map<string, StringEntry>();
  const list: StringEntry[] = [];
  const byCopyId = new Map<string, StringEntry[]>();
  const loose: StringEntry[] = [];
  for (const item of figma) {
    if (item.copyId) {
      const group = byCopyId.get(item.copyId) ?? [];
      group.push(item);
      byCopyId.set(item.copyId, group);
    } else loose.push(item);
  }
  const records = new Map((catalog?.records ?? []).map((record) => [record.copyId, record]));
  const mappedKeys = new Map<string, string[]>();
  const keysOf = new Map<StringEntry, string[]>();
  for (const mapping of catalog?.mappings ?? []) {
    const keys = mappedKeys.get(mapping.copyId) ?? [];
    keys.push(mapping.variableKey);
    mappedKeys.set(mapping.copyId, keys);
  }

  for (const record of records.values()) {
    const variables = byCopyId.get(record.copyId) ?? [];
    byCopyId.delete(record.copyId);
    // The published library variable names the entry; local mirrors become aliases.
    const base = variables.find((v) => !v.local) ?? variables[0];
    const key = base?.key ?? registryKey(record.copyId);
    // `fromRecord` may return a cached entry; copy it before adding merge-specific fields.
    const merged = { ...fromRecord(record, key, base) };
    merged.bindKey =
      (
        variables.find((v) => !v.local && current(v, record)) ??
        variables.find((v) => current(v, record))
      )?.key ?? registryKey(record.copyId);
    merged.aliases = [
      ...new Set([
        ...merged.aliases,
        ...variables.map((v) => v.name),
        ...variables.map((v) => v.key),
      ]),
    ];
    const keys = [
      key,
      registryKey(record.copyId),
      ...variables.map((v) => v.key),
      ...(mappedKeys.get(record.copyId) ?? []),
    ];
    for (const k of keys) entries.set(k, merged);
    keysOf.set(merged, keys);
    if (SEARCHABLE.has(record.status)) list.push(merged);
  }
  // Records may follow a merge: old identities resolve to where their copy lives now.
  for (const record of records.values()) {
    if (record.status !== 'merged' || !record.mergedInto) continue;
    const target = entries.get(registryKey(record.mergedInto));
    if (!target) continue;
    const from = entries.get(registryKey(record.copyId));
    if (!from || from === target) continue;
    // Only keys still pointing at `from` move; a key re-assigned since keeps its newer entry.
    const moved = keysOf.get(from) ?? [];
    for (const key of moved) if (entries.get(key) === from) entries.set(key, target);
    keysOf.set(target, [...(keysOf.get(target) ?? []), ...moved]);
    keysOf.delete(from);
  }
  // Library strings the registry does not know (yet), e.g. while offline.
  for (const group of byCopyId.values()) loose.push(...group);
  for (const item of loose) {
    entries.set(item.key, item);
    list.push(item);
  }
  return { entries, list };
}
