import { describe, it, expect } from 'vitest';
import { extractFrames } from '../mcp/extract';
import { describeRecord, sha256 } from '@string-binder/domain';
import type { CopyRecord } from '@string-binder/contracts';
function fixture() {
  const record: CopyRecord = {
    copyId: 'cp_01K0000000E00R000000000001',
    platformKey: 'gopay_test_title',
    revision: 1,
    en: ' Hello 世界 🚀\n',
    id: ' Halo 世界 🚀\n',
    product: 'test',
    context: { feature: '', screen: 'frame', context: '', role: 'title', note: '' },
    status: 'active',
    aliases: [],
  };
  const c = {
    id: 'c',
    modes: [
      { modeId: 'en-mode', name: 'EN' },
      { modeId: 'id-mode', name: 'ID' },
    ],
  };
  const v: any = {
    id: 'v',
    key: 'vk',
    name: record.platformKey,
    variableCollectionId: c.id,
    valuesByMode: { 'en-mode': record.en, 'id-mode': record.id },
    description: describeRecord(record),
    getSharedPluginData: (_: string, k: string) =>
      k === 'id' ? record.copyId : k === 'record' ? JSON.stringify(record) : '',
  };
  const n: any = {
    id: 'n',
    type: 'TEXT',
    name: record.platformKey,
    characters: record.en,
    visible: true,
    boundVariables: { characters: { id: 'v' } },
    resolvedVariableModes: { c: 'en-mode' },
    getSharedPluginData: (_: string, k: string) => (k === 'snapshot' ? JSON.stringify(record) : ''),
  };
  const frame: any = {
    id: 'frame',
    name: 'Frame',
    type: 'FRAME',
    children: [
      n,
      { id: 'unmanaged', name: 'Amount', type: 'TEXT', characters: 'Rp1.000', visible: true },
    ],
  };
  const vars = new Map<string, any>([[v.id, v]]);
  const figma: any = {
    getNodeByIdAsync: async () => frame,
    variables: {
      getVariableByIdAsync: async (id: string) => vars.get(id),
      getVariableCollectionByIdAsync: async () => c,
    },
  };
  return { record, c, v, n, frame, vars, figma };
}
async function bundle(figma: any) {
  let cursor = 0,
    expectedHash: string | undefined;
  let text = '';
  for (;;) {
    const chunk = await extractFrames(figma, { frameIds: ['frame'], cursor, expectedHash });
    expectedHash ??= chunk.snapshotHash;
    text += chunk.chunk;
    if (chunk.nextCursor === null) {
      expect(sha256(text)).toBe(chunk.snapshotHash);
      return JSON.parse(text);
    }
    cursor = chunk.nextCursor;
  }
}
describe('read-only frame extraction', () => {
  it('returns exact applied bilingual values, occurrence language and unmanaged text', async () => {
    const f = fixture();
    const b = await bundle(f.figma);
    expect(b.ready).toBe(true);
    expect(b.records[0].en).toBe(f.record.en);
    expect(b.records[0].id).toBe(f.record.id);
    expect(b.occurrences[0].locale).toBe('en');
    expect(b.unmanaged[0].nodeId).toBe('unmanaged');
  });
  it('reports unpushed wording and stale metadata', async () => {
    const f = fixture();
    f.v.valuesByMode['en-mode'] = 'Unpushed';
    const b = await bundle(f.figma);
    expect(b.ready).toBe(false);
    expect(b.records).toHaveLength(0);
    expect(b.issues[0].message).toMatch(/Unpushed/);
  });
  it('resolves alias modes and rejects cycles or missing translations', async () => {
    const f = fixture();
    const target = { ...f.v, id: 'target' };
    f.vars.set('target', target);
    f.v.valuesByMode = {
      'en-mode': { type: 'VARIABLE_ALIAS', id: 'target' },
      'id-mode': { type: 'VARIABLE_ALIAS', id: 'target' },
    };
    expect((await bundle(f.figma)).ready).toBe(true);
    target.valuesByMode = f.v.valuesByMode;
    expect((await bundle(f.figma)).issues[0].message).toMatch(/cycle/);
  });
  it('reassembles a large individual record and refuses changed snapshots between chunks', async () => {
    const f = fixture();
    f.record.en = '世界 🚀'.repeat(6000);
    f.record.id = 'Halo '.repeat(6000);
    f.v.valuesByMode['en-mode'] = f.record.en;
    f.v.valuesByMode['id-mode'] = f.record.id;
    f.v.description = describeRecord(f.record);
    f.n.characters = f.record.en;
    const first = await extractFrames(f.figma, { frameIds: ['frame'] });
    expect(first.nextCursor).not.toBeNull();
    expect(JSON.stringify(first).length).toBeLessThan(20000);
    expect((await bundle(f.figma)).records[0].en).toBe(f.record.en);
    f.frame.name = 'Changed frame';
    await expect(
      extractFrames(f.figma, {
        frameIds: ['frame'],
        cursor: first.nextCursor!,
        expectedHash: first.snapshotHash,
      }),
    ).rejects.toThrow('between chunks');
  });
  it('detects inconsistent identity revisions in multiple requested frames', async () => {
    const a = fixture(),
      b = fixture();
    b.record.revision = 2;
    b.v.id = 'v2';
    b.v.description = describeRecord(b.record);
    b.n.id = 'n2';
    b.n.boundVariables.characters.id = 'v2';
    b.frame.id = 'frame2';
    a.vars.set('v2', b.v);
    a.figma.getNodeByIdAsync = async (id: string) => (id === 'frame2' ? b.frame : a.frame);
    const response = await extractFrames(a.figma, { frameIds: ['frame', 'frame2'] });
    const parsed = JSON.parse(response.chunk);
    expect(parsed.ready).toBe(false);
    expect(parsed.issues.some((i: any) => i.code === 'REVISION_CONFLICT')).toBe(true);
  });
  it('protects unpushed context and detects binding changes during a read', async () => {
    const f = fixture();
    f.v.description += '\nNote: Manual change';
    const context = await bundle(f.figma);
    expect(context.ready).toBe(false);
    expect(context.issues[0].message).toMatch(/context/);
    const g = fixture();
    let reads = 0;
    g.figma.variables.getVariableByIdAsync = async (id: string) => {
      if (++reads === 2) g.n.boundVariables.characters.id = 'different';
      return g.vars.get(id);
    };
    await expect(extractFrames(g.figma, { frameIds: ['frame'] })).rejects.toThrow(
      'during extraction',
    );
  });
  it('switches to one requested page per call and rejects mixing pages', async () => {
    const f = fixture();
    let switches = 0;
    const page = { id: 'page', type: 'PAGE' };
    f.frame.parent = page;
    f.figma.setCurrentPageAsync = async () => {
      switches++;
    };
    await extractFrames(f.figma, { frameIds: ['frame'] });
    expect(switches).toBe(1);
    const second = { ...f.frame, id: 'other-frame', parent: { id: 'other-page', type: 'PAGE' } };
    f.figma.getNodeByIdAsync = async (id: string) => (id === 'frame' ? f.frame : second);
    await expect(extractFrames(f.figma, { frameIds: ['frame', 'other-frame'] })).rejects.toThrow(
      'one page',
    );
  });
});

it('assembles complete chunks and detects cross-file revisions without choosing a winner', async () => {
  const { assembleChunks, combineBundles } = await import('../mcp/assemble');
  const a = fixture();
  a.record.en = 'A'.repeat(4000);
  a.v.valuesByMode['en-mode'] = a.record.en;
  a.n.characters = a.record.en;
  a.v.description = describeRecord(a.record);
  const chunks: Awaited<ReturnType<typeof extractFrames>>[] = [];
  let cursor = 0;
  let expectedHash: string | undefined;
  for (;;) {
    const chunk = await extractFrames(a.figma, {
      frameIds: ['frame'],
      cursor,
      expectedHash,
      fileLabel: 'File A',
    });
    chunks.push(chunk);
    expectedHash ??= chunk.snapshotHash;
    if (chunk.nextCursor === null) break;
    cursor = chunk.nextCursor;
  }
  const first = assembleChunks(chunks);
  expect(first.records[0].en).toBe(a.record.en);
  expect(() => assembleChunks(chunks.slice(0, -1))).toThrow('incomplete');
  const b = fixture();
  b.record.revision = 2;
  b.v.description = describeRecord(b.record);
  const second = await bundle(b.figma);
  const combined = combineBundles([first, { ...second, fileLabel: 'File B' }]);
  expect(combined.ready).toBe(false);
  expect(combined.issues[0].code).toBe('REVISION_CONFLICT');
  expect(combined.records).toHaveLength(2);
  expect(combined.occurrences.map((o) => o.fileLabel)).toEqual(['File A', 'File B']);
});
