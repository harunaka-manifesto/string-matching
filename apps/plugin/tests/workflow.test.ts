import { beforeEach, expect, it, vi } from 'vitest';
import { figmaFixture } from './figma-fixture';
import type { CopyRecord } from '@string-binder/contracts';
import { localFingerprint } from '@string-binder/domain';
import { materialize, scanLocal, usageCounts } from '../src/main/delivery';
import { readPrivate } from '../src/main/private-storage';
const mocks = vi.hoisted(() => ({ api: vi.fn(), catalog: vi.fn(), settings: vi.fn() }));
vi.mock('../src/main/registry-api', () => ({ ...mocks, WorkflowError: Error }));
vi.mock('../src/main/apply', () => ({ previewApply: vi.fn() }));
vi.mock('../src/main/library-index', () => ({
  readVariableValues: async (v: any) => {
    const c = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
    return {
      en: v.valuesByMode[c!.modes.find((m) => m.name === 'EN')!.modeId],
      id: v.valuesByMode[c!.modes.find((m) => m.name === 'ID')!.modeId],
    };
  },
}));
import { workflow } from '../src/main/workflow';
const r: CopyRecord = {
  copyId: 'cp_01K0000000E00R000000000001',
  platformKey: 'gopay_test_screen_title',
  revision: 1,
  en: 'Hello',
  id: 'Halo',
  product: 'test',
  context: { feature: '', screen: 'screen', context: '', role: 'title', note: '' },
  status: 'active',
  aliases: [],
};
let f: ReturnType<typeof figmaFixture>;
beforeEach(() => {
  f = figmaFixture();
  const data = new Map<string, unknown>();
  const plugin = new Map<string, string>([['registry:library', 'test-file']]);
  Object.assign(f.figma.root, {
    getPluginData: (k: string) => plugin.get(k) ?? '',
    setPluginData: (k: string, v: string) => plugin.set(k, v),
  });
  f.figma.clientStorage = {
    keysAsync: async () => [...data.keys()],
    getAsync: async (k: string) => data.get(k),
    setAsync: async (k: string, v: unknown) => {
      data.set(k, v);
    },
    deleteAsync: async (k: string) => {
      data.delete(k);
    },
  };
  vi.stubGlobal('figma', f.figma);
  mocks.api.mockReset().mockResolvedValue({});
  mocks.settings.mockResolvedValue({
    libraryId: 'test-library',
    fileKey: 'test-file',
    publisherToken: 'test',
  });
  mocks.catalog.mockResolvedValue({
    seq: 0,
    records: [r],
    products: [{ id: 'test', displayName: 'Test', keyToken: 'test' }],
    mappings: [],
  });
});
const start = async (records: CopyRecord[], entries: unknown[]) =>
  workflow('library:start', { runId: 'test-run', owner: 'test-owner', records, entries });
it('identifies a direct-library creation on the original variable without duplication', async () => {
  const c = f.createCollection('Test');
  c.addMode('EN');
  const v = f.createVariable('Draft title', c);
  v.setValueForMode('id', 'Halo');
  v.setValueForMode(c.modes.find((m: any) => m.name === 'EN').modeId, 'Hello');
  const l = (await scanLocal())[0]!;
  await start(
    [r],
    [{ copyId: r.copyId, variableId: v.id, fingerprint: localFingerprint(l), overwrite: true }],
  );
  const result: any = await workflow('library:apply', { runId: 'test-run' });
  expect(result.failures).toEqual([]);
  expect(f.vars).toHaveLength(1);
  expect(result.mappings[0].variableKey).toBe(v.key);
  expect(v.name).toBe(r.platformKey);
});
it('consolidates multiple explicitly reused temporary variables with verified language-preserving bindings', async () => {
  const canonical = await materialize(r, 'Test', true);
  const c = f.collections[0];
  const entries = [];
  const nodes = [];
  for (let i = 0; i < 2; i++) {
    const temp = f.createVariable('Temporary ' + i, c);
    temp.setValueForMode('id', r.id);
    temp.setValueForMode(c.modes.find((m: any) => m.name === 'EN').modeId, r.en);
    const n = f.text();
    n.setBoundVariable('characters', temp);
    const mode = i === 0 ? 'id' : c.modes.find((m: any) => m.name === 'EN').modeId;
    n.setExplicitVariableModeForCollection(c, mode);
    nodes.push(n);
    const local = (await scanLocal()).find((l) => l.variableId === temp.id)!;
    entries.push({
      copyId: r.copyId,
      variableId: temp.id,
      fingerprint: localFingerprint(local),
      reuse: true,
    });
  }
  await start([r], entries);
  const result: any = await workflow('library:apply', { runId: 'test-run' });
  expect(result.failures).toEqual([]);
  expect(f.vars).toEqual([canonical]);
  expect(nodes.map((n) => n.characters)).toEqual([r.id, r.en]);
  expect(nodes.every((n) => n.boundVariables.characters.id === canonical.id)).toBe(true);
});
it('protects a variable changed since review and resumes after explicit review of remaining work', async () => {
  const v = await materialize(r, 'Test', true);
  const local = (await scanLocal())[0]!;
  const newer = { ...r, revision: 2, en: 'Updated', id: 'Terbaru' };
  await start(
    [newer],
    [{ copyId: r.copyId, variableId: v.id, fingerprint: localFingerprint(local), overwrite: true }],
  );
  v.setValueForMode('id', 'Unpushed');
  const first: any = await workflow('library:apply', { runId: 'test-run' });
  expect(first.failures).toHaveLength(1);
  expect(v.valuesByMode.id).toBe('Unpushed');
  const reviewed = (await scanLocal())[0]!;
  await start(
    [newer],
    [
      {
        copyId: r.copyId,
        variableId: v.id,
        fingerprint: localFingerprint(reviewed),
        overwrite: true,
      },
    ],
  );
  const retry: any = await workflow('library:apply', { runId: 'test-run' });
  expect(retry.failures).toEqual([]);
  expect(v.valuesByMode.id).toBe('Terbaru');
  expect(f.vars).toHaveLength(1);
});
it('persists partial Figma progress and retries binding without minting a second variable', async () => {
  const v = await materialize(r, 'Test', true);
  const n = f.text();
  n.setBoundVariable('characters', v);
  n.setExplicitVariableModeForCollection(f.collections[0], 'id');
  n.failBinding = true;
  const next = { ...r, revision: 2, id: 'Terbaru' };
  const l = (await scanLocal())[0]!;
  await start(
    [next],
    [{ copyId: r.copyId, variableId: v.id, fingerprint: localFingerprint(l), overwrite: true }],
  );
  const first: any = await workflow('library:apply', { runId: 'test-run' });
  expect(first.failures).toHaveLength(1);
  const retry: any = await workflow('library:apply', { runId: 'test-run' });
  expect(retry.failures).toEqual([]);
  expect(f.vars).toHaveLength(1);
  expect((await readPrivate<any>('registry:run')).applied).toHaveLength(1);
});
it('never overwrites a newer local revision and verifies exact publication status and context', async () => {
  const v = await materialize({ ...r, revision: 2 }, 'Test', true);
  const l = (await scanLocal())[0]!;
  await start(
    [r],
    [{ copyId: r.copyId, variableId: v.id, fingerprint: localFingerprint(l), overwrite: true }],
  );
  expect(
    ((await workflow('library:apply', { runId: 'test-run' })) as any).failures[0].reason,
  ).toContain('newer');
  await start(
    [{ ...r, revision: 2 }],
    [{ copyId: r.copyId, variableId: v.id, fingerprint: localFingerprint(l), overwrite: true }],
  );
  await workflow('library:apply', { runId: 'test-run' });
  v.getPublishStatusAsync = async () => 'CHANGED';
  await expect(workflow('library:publish', {})).rejects.toThrow('Publish the exact');
  v.getPublishStatusAsync = async () => 'CURRENT';
  v.description += '\nNote: Unpushed context';
  await expect(workflow('library:publish', {})).rejects.toThrow('Publish the exact');
});
it('preflights every affected font before shared library values change', async () => {
  const v = await materialize(r, 'Test', true);
  const n = f.text();
  n.setBoundVariable('characters', v);
  n.hasMissingFont = true;
  const l = (await scanLocal())[0]!;
  await start(
    [{ ...r, revision: 2, id: 'New' }],
    [{ copyId: r.copyId, variableId: v.id, fingerprint: localFingerprint(l), overwrite: true }],
  );
  expect(
    ((await workflow('library:apply', { runId: 'test-run' })) as any).failures[0].reason,
  ).toContain('Missing font');
  expect(v.valuesByMode.id).toBe(r.id);
});

it('requires a publisher token, and lets Change setup correct a wrongly stamped file', async () => {
  mocks.settings.mockResolvedValue({});
  await expect(
    workflow('settings:save', { libraryId: 'test-library', fileKey: 'test-file' }),
  ).rejects.toThrow('publisher token');
  expect(await f.figma.clientStorage.getAsync('registry:settings')).toBeUndefined();
  // The document was stamped with a wrong key; saving a corrected setup replaces it.
  (f.figma.root as any).setPluginData('registry:library', 'wrong-file');
  await workflow('settings:save', {
    libraryId: 'test-library',
    fileKey: 'test-file',
    publisherToken: ' secret ',
  });
  expect(await f.figma.clientStorage.getAsync('registry:settings')).toEqual({
    libraryId: 'test-library',
    fileKey: 'test-file',
    publisherToken: 'secret',
  });
  expect((f.figma.root as any).getPluginData('registry:library')).toBe('test-file');
  // Sync itself still refuses a document stamped for another library.
  mocks.settings.mockResolvedValue({
    libraryId: 'test-library',
    fileKey: 'other-file',
    publisherToken: 's',
  });
  await expect(workflow('library:scan', {})).rejects.toThrow('set up as another library');
});
it('background refresh only updates local values: no page loads, renames or rebinding', async () => {
  (f.figma.root as any).setPluginData('registry:library', '');
  const loads = vi.spyOn(f.figma, 'loadAllPagesAsync');
  const v = await materialize(r, 'Test');
  const text = f.text('Hello');
  text.setBoundVariable('characters', v);
  text.name = 'Writer named this';
  const next = { ...r, revision: 2, en: 'Hello there', id: 'Halo semua' };
  mocks.catalog.mockResolvedValue({ seq: 1, records: [next], products: [], mappings: [] });
  const { result } = (await workflow('refresh', { force: true })) as any;
  expect(result.applied).toEqual([v.id]);
  expect(loads).not.toHaveBeenCalled();
  expect(text.name).toBe('Writer named this');
  expect(text.boundVariables.characters.id).toBe(v.id);
  const c = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
  expect(v.valuesByMode[c!.modes.find((m) => m.name === 'EN')!.modeId]).toBe('Hello there');
  // Hand edits are protected and reported instead of overwritten.
  v.setValueForMode(c!.modes.find((m) => m.name === 'EN')!.modeId, 'Hand edit');
  mocks.catalog.mockResolvedValue({
    seq: 2,
    records: [{ ...next, revision: 3, en: 'Third' }],
    products: [],
    mappings: [],
  });
  const second = (await workflow('refresh', {})) as any;
  expect(second.result.conflicts).toEqual([v.id]);
  expect(v.valuesByMode[c!.modes.find((m) => m.name === 'EN')!.modeId]).toBe('Hand edit');
});
it('counts current-file usages of an identity, including duplicate mirrors', async () => {
  const v = await materialize(r, 'Test', true);
  const mirror = f.createVariable('mirror', f.collections[0]);
  mirror.setSharedPluginData('copy', 'id', r.copyId);
  f.text('A').setBoundVariable('characters', v);
  f.text('B').setBoundVariable('characters', mirror);
  f.text('Unbound');
  expect(await usageCounts(new Set([r.copyId]))).toEqual({ [r.copyId]: 2 });
  expect(await usageCounts(new Set(['cp_other']))).toEqual({});
});
