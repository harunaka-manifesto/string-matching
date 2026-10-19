import { beforeEach, it, expect, vi } from 'vitest';
import { figmaFixture } from './figma-fixture';
import { canvasFingerprint } from '@string-binder/domain';
import {
  bindRecord,
  deliver,
  followFrameModes,
  materialize,
  refreshUsed,
  stamp,
  variableFingerprint,
} from '../src/main/delivery';
import type { CopyRecord, BindingTarget } from '@string-binder/contracts';
vi.mock('../src/main/library-index', () => ({
  readVariableValues: async (v: any) => {
    const c = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
    return {
      en: v.valuesByMode[c!.modes.find((m) => m.name === 'EN')!.modeId],
      id: v.valuesByMode[c!.modes.find((m) => m.name === 'ID')!.modeId],
    };
  },
}));
let fixture: ReturnType<typeof figmaFixture>;
const r: CopyRecord = {
  copyId: 'cp_01K0000000E00R000000000001',
  platformKey: 'gopay_test_frame_title',
  revision: 1,
  en: ' Hello\n🚀 ',
  id: ' Halo\n🚀 ',
  product: 'test',
  context: { feature: '', screen: 'frame', context: '', role: 'title', note: '' },
  status: 'active',
  aliases: [],
};
const products = [{ id: 'test', displayName: 'Test' }];
const target = (n: any, locale: 'en' | 'id' = 'id'): BindingTarget => ({
  nodeId: n.id,
  sourceId: n.id,
  copyId: r.copyId,
  locale,
  fingerprint: canvasFingerprint({
    id: n.id,
    name: n.name,
    characters: n.characters,
    boundKey: null,
  }),
  frameName: 'Frame',
  duplicate: false,
});
beforeEach(() => {
  fixture = figmaFixture();
  vi.stubGlobal('figma', fixture.figma);
});
it('recovers binding failures without recreating saved variables or rejecting completed targets', async () => {
  const a = fixture.text(),
    b = fixture.text('Body');
  b.failBinding = true;
  const targets = [target(a, 'en'), target(b)];
  const first = await deliver([r], targets, products);
  expect(first.failures).toHaveLength(1);
  expect(a.characters).toBe(r.en);
  expect(fixture.vars).toHaveLength(1);
  const retry = await deliver([r], targets, products);
  expect(retry.conflicts).toEqual([]);
  expect(retry.failures).toEqual([]);
  expect(retry.applied).toContain(a.id);
  expect(b.characters).toBe(r.id);
  expect(fixture.vars).toHaveLength(1);
});
it('does not bind, rename, or change modes on a kept occurrence', async () => {
  const a = fixture.text(),
    keep = fixture.text('Amount', 'Rp10.000');
  await deliver([r], [target(a)], products);
  expect(keep.name).toBe('Amount');
  expect(keep.characters).toBe('Rp10.000');
  expect(keep.resolvedVariableModes).toEqual({});
});
it('detects canvas changes after a save and leaves changed occurrences untouched', async () => {
  const a = fixture.text();
  const t = target(a);
  a.characters = 'Writer changed canvas';
  const result = await deliver([r], [t], products);
  expect(result.conflicts).toContain(a.id);
  expect(a.characters).toBe('Writer changed canvas');
  expect(fixture.vars).toHaveLength(0);
});
it('protects manually edited variables and all duplicate mirrors during refresh', async () => {
  const v = await materialize(r, 'Test');
  const c = fixture.collections[0];
  v.setValueForMode(c.modes.find((m: any) => m.name === 'ID').modeId, 'Unpushed');
  const a = fixture.text();
  a.setBoundVariable('characters', v);
  a.setExplicitVariableModeForCollection(c, 'id');
  const result = await refreshUsed([{ ...r, revision: 2, id: 'Remote' }], products, [], []);
  expect(result.conflicts).toContain(v.id);
  expect(a.characters).toBe('Unpushed');
  expect(fixture.vars).toHaveLength(1);
});
it('migrates a stale imported binding to a newer local revision preserving its language', async () => {
  const v = await materialize(r, 'Test');
  v.remote = true;
  v.setSharedPluginData('copy', 'delivery', '');
  const c = fixture.collections[0];
  const a = fixture.text();
  a.setBoundVariable('characters', v);
  a.setExplicitVariableModeForCollection(c, c.modes.find((m: any) => m.name === 'EN').modeId);
  const result = await refreshUsed(
    [{ ...r, revision: 2, en: 'Updated EN', id: 'Updated ID' }],
    products,
    [],
    [],
  );
  expect(result.failures).toEqual([]);
  expect(a.characters).toBe('Updated EN');
  expect(a.boundVariables.characters.id).not.toBe(v.id);
});
it('refuses older materialization and preflights missing fonts before changing shared copy', async () => {
  const v = await materialize({ ...r, revision: 2 }, 'Test');
  await expect(materialize(r, 'Test')).rejects.toThrow('newer');
  const a = fixture.text();
  a.setBoundVariable('characters', v);
  // Neither the layer's font nor the Rupa Sans fallback is installed.
  fixture.missingFonts.add('Inter').add('Rupa Sans');
  a.hasMissingFont = true;
  await deliver([{ ...r, revision: 3, id: 'Changed' }], [], products, [r.copyId]);
  expect(v.valuesByMode.id).toBe(r.id);
});

it('replaces a missing font with Rupa Sans Regular at the same size, then updates shared copy', async () => {
  const v = await materialize({ ...r, revision: 2 }, 'Test');
  const a = fixture.text();
  a.setBoundVariable('characters', v);
  a.fontName = { family: 'GoPay Display', style: 'Bold' };
  a.fontSize = 18;
  fixture.missingFonts.add('GoPay Display');
  a.hasMissingFont = true;
  await deliver([{ ...r, revision: 3, id: 'Changed' }], [], products, [r.copyId]);
  expect(a.fontName).toEqual({ family: 'Rupa Sans', style: 'Regular' });
  expect(a.fontSize).toBe(18);
  expect(a.hasMissingFont).toBe(false);
  expect(v.valuesByMode.id).toBe('Changed');
});

it('protects a translation changed after review even when the displayed locale is unchanged', async () => {
  const v = await materialize(r, 'Test');
  const c = fixture.collections[0];
  const n = fixture.text();
  n.setBoundVariable('characters', v);
  n.setExplicitVariableModeForCollection(c, 'id');
  const t = {
    ...target(n),
    fingerprint: canvasFingerprint({
      id: n.id,
      name: n.name,
      characters: n.characters,
      boundKey: v.key,
    }),
    variableFingerprint: await variableFingerprint(v),
  };
  v.setValueForMode(c.modes.find((m: any) => m.name === 'EN').modeId, 'New manual EN');
  const result = await deliver(
    [{ ...r, revision: 2, id: 'Updated ID' }],
    [t],
    products,
    [r.copyId],
    [r.copyId],
  );
  expect(result.conflicts).toContain(n.id);
  expect(v.valuesByMode.id).toBe(r.id);
});
it('validates imported publication metadata when shared variable records are unavailable', async () => {
  const v = await materialize(r, 'Test');
  v.remote = true;
  v.setSharedPluginData('copy', 'record', '');
  v.setSharedPluginData('copy', 'delivery', '');
  const n = fixture.text();
  n.setBoundVariable('characters', v);
  n.setExplicitVariableModeForCollection(fixture.collections[0], 'id');
  const result = await refreshUsed([r], products, [], []);
  expect(result.conflicts).toEqual([]);
  expect(result.failures).toEqual([]);
  expect(JSON.parse(n.getSharedPluginData('copy', 'snapshot')).revision).toBe(r.revision);
  expect(fixture.vars).toHaveLength(1);
});

it('lets a bound layer follow its frame’s language, giving a frame without one the layer’s', async () => {
  const v = await materialize(r, 'Test');
  const c = fixture.collections[0];
  const en = c.modes.find((m: any) => m.name === 'EN').modeId;
  const frame = fixture.frame();
  const n = fixture.text();
  n.parent = frame;
  await bindRecord(n, v, r, 'en');
  expect(n.explicitVariableModes).toEqual({});
  expect(frame.explicitVariableModes[c.id]).toBe(en);
  expect(n.characters).toBe(r.en);
  // Switching the frame switches the layer.
  frame.setExplicitVariableModeForCollection(c, 'id');
  expect(n.characters).toBe(r.id);
  // A later layer showing the other language follows the frame too.
  const other = fixture.text();
  other.parent = frame;
  await bindRecord(other, v, r, 'en');
  expect(other.explicitVariableModes).toEqual({});
  expect(other.characters).toBe(r.id);
});

it('unpins layers bound by older versions so the frame decides, keeping the majority language', async () => {
  const v = await materialize(r, 'Test');
  const c = fixture.collections[0];
  const en = c.modes.find((m: any) => m.name === 'EN').modeId;
  const frame = fixture.frame();
  const layers = ['en', 'en', 'id'].map((locale) => {
    const n = fixture.text();
    n.parent = frame;
    n.setBoundVariable('characters', v);
    n.setExplicitVariableModeForCollection(c, locale === 'en' ? en : 'id');
    return n;
  });
  expect(await followFrameModes(frame)).toBe(3);
  expect(frame.explicitVariableModes[c.id]).toBe(en);
  for (const n of layers) {
    expect(n.explicitVariableModes).toEqual({});
    expect(n.characters).toBe(r.en);
  }
  frame.setExplicitVariableModeForCollection(c, 'id');
  for (const n of layers) expect(n.characters).toBe(r.id);
});
