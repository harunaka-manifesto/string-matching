import type { Catalog, CopyRecord } from '@string-binder/contracts';
import { describe, expect, it } from 'vitest';
import { mergeIndex, registryCopyId, registryKey } from '../src/ui/index-merge';
import type { StringEntry } from '../src/ui/string-index';

const copyId = 'cp_01K0000000E00R000000000001';
const record = (patch: Partial<CopyRecord> = {}): CopyRecord => ({
  copyId,
  platformKey: 'gopay_investment_buy_cta',
  revision: 2,
  en: 'Buy',
  id: 'Beli',
  product: 'investment',
  context: { feature: 'gold', screen: 'buy', context: '', role: 'cta', note: '' },
  status: 'active',
  aliases: [],
  ...patch,
});
const variable = (key: string, patch: Partial<StringEntry> = {}): StringEntry =>
  ({
    key,
    name: `investment/${key}`,
    collection: 'Investment',
    order: 0,
    en: 'Buy',
    id: 'Beli',
    description: '',
    loaded: true,
    product: 'investment',
    path: '',
    copyId,
    aliases: [],
    contexts: [],
    feature: '',
    section: '',
    local: false,
    ...patch,
  }) as StringEntry;
const catalog = (records: CopyRecord[], mappings: Catalog['mappings'] = []): Catalog => ({
  seq: 1,
  records,
  products: [],
  mappings,
});
const fromRecord = (r: CopyRecord, key: string, base?: StringEntry) => ({
  ...(base ?? variable(key, { local: false })),
  key,
  en: r.en,
  id: r.id,
  record: r,
  aliases: [] as string[],
});

describe('mergeIndex', () => {
  it('keeps layers bound to library variables resolvable after the registry loads', () => {
    const merged = mergeIndex([variable('lib-key')], catalog([record()]), fromRecord);
    expect(merged.entries.get('lib-key')?.record?.copyId).toBe(copyId);
    expect(merged.entries.get(registryKey(copyId))).toBe(merged.entries.get('lib-key'));
    expect(merged.list).toHaveLength(1);
  });

  it('binds through the variable that already shows the latest wording', () => {
    const stale = variable('lib-key', { en: 'Old', id: 'Lama' });
    const mirror = variable('local-key', { local: true });
    const merged = mergeIndex([stale, mirror], catalog([record()]), fromRecord);
    const entry = merged.entries.get('lib-key')!;
    expect(entry.key).toBe('lib-key');
    expect(entry.bindKey).toBe('local-key');
    expect(merged.entries.get('local-key')).toBe(entry);
    expect(merged.list).toHaveLength(1);
  });

  it('materializes saved copy no variable carries yet', () => {
    const merged = mergeIndex([], catalog([record()]), fromRecord);
    expect(merged.entries.get(registryKey(copyId))?.bindKey).toBe(registryKey(copyId));
  });

  it('hides archived and merged copy from search but keeps it resolvable', () => {
    const target = record({ copyId: 'cp_01K0000000E00R000000000002', platformKey: 'kept' });
    const merged = mergeIndex(
      [variable('old-key')],
      catalog([record({ status: 'merged', mergedInto: target.copyId }), target]),
      fromRecord,
    );
    expect(merged.list.map((e) => e.record?.platformKey)).toEqual(['kept']);
    expect(merged.entries.get('old-key')?.record?.platformKey).toBe('kept');
  });

  it('registers published mapping keys as aliases and leaves unknown variables alone', () => {
    const merged = mergeIndex(
      [variable('loose', { copyId: '' })],
      catalog(
        [record()],
        [
          {
            libraryId: 'lib',
            copyId,
            variableKey: 'published-key',
            variableId: 'v',
            syncedRevision: 2,
            publishedRevision: 2,
            fingerprint: 'x',
          },
        ],
      ),
      fromRecord,
    );
    expect(merged.entries.get('published-key')?.record?.copyId).toBe(copyId);
    expect(merged.entries.get('loose')?.record).toBeUndefined();
    expect(merged.list).toHaveLength(2);
  });

  it('joins a published variable whose values never loaded to its record by mapping', () => {
    const unloaded = variable('published-key', { copyId: '', loaded: false, en: '', id: '' });
    const merged = mergeIndex(
      [unloaded],
      catalog(
        [record()],
        [
          {
            libraryId: 'lib',
            copyId,
            variableKey: 'published-key',
            variableId: 'v',
            syncedRevision: 2,
            publishedRevision: 2,
            fingerprint: 'x',
          },
        ],
      ),
      fromRecord,
    );
    expect(merged.list).toHaveLength(1);
    expect(merged.list[0]?.key).toBe('published-key');
    expect(merged.entries.get('published-key')?.en).toBe('Buy');
    // Not known to carry the latest wording, so Apply binds through the registry record.
    expect(merged.entries.get('published-key')?.bindKey).toBe(registryKey(copyId));
  });

  it('reads copy IDs from old revision-suffixed registry keys', () => {
    expect(registryCopyId(`registry:${copyId}:3`)).toBe(copyId);
    expect(registryCopyId(registryKey(copyId))).toBe(copyId);
    expect(registryCopyId('figma-key')).toBeNull();
  });
});
