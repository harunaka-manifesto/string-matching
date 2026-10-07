import type { AuthoringDraft, CopyRecord, LayerInfo } from '@string-binder/contracts';
import { buildSequenceSource, canvasFingerprint } from '@string-binder/domain';
import { describe, expect, it, vi } from 'vitest';
import { decisionsFor, resolveRows, type RowState } from '../src/ui/frame-rows';
import {
  composeCreate,
  composeVariant,
  fromDraft,
  rebaseline,
  screenOf,
  toDraft,
} from '../src/ui/writer/model';

vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(7) });

const layer = (id: string, patch: Partial<LayerInfo> = {}): LayerInfo => ({
  id,
  name: id,
  characters: 'Lorem ipsum',
  inInstance: false,
  boundKey: null,
  boundName: null,
  stored: null,
  autoSkipReason: null,
  ...patch,
});
const record: CopyRecord = {
  copyId: 'cp_01K0000000E00R000000000001',
  platformKey: 'gopay_investment_buy_cta',
  revision: 1,
  en: 'Buy',
  id: 'Beli',
  product: 'investment',
  context: { feature: '', screen: 'buy', context: '', role: 'cta', note: '' },
  status: 'active',
  aliases: [],
};

describe('writer model', () => {
  it('drafted rows take no slot in the legacy sequence and send no bind decision', () => {
    const sequences = buildSequenceSource({
      orderedNames: { T: ['p/a', 'p/b', 'p/c'] },
      variables: ['a', 'b', 'c'].map((n, order) => ({
        key: n,
        name: `p/${n}`,
        collection: 'L',
        order,
      })),
    });
    const layers = [layer('1', { boundKey: 'a' }), layer('2'), layer('3')];
    const states = new Map<string, RowState>([
      [
        '2',
        {
          status: 'include',
          pick: null,
          unbind: false,
          shift: 0,
          compose: composeCreate(layers[1]!, 'id', 'p', 'Frame'),
        },
      ],
    ]);
    const rows = resolveRows(layers, states, sequences);
    expect(rows.map((r) => r.key)).toEqual(['a', null, 'b']);
    expect(decisionsFor(rows).map((d) => d.layerId)).toEqual(['1', '3']);
  });

  it('keeps an existing binding when the pick is the same identity', () => {
    const rows = resolveRows(
      [layer('1', { boundKey: 'mirror' })],
      new Map([['1', { status: 'include', pick: 'library', unbind: false, shift: 0 }]]),
      { sequences: new Map(), positions: new Map() },
    );
    expect(decisionsFor(rows, (key, bound) => (bound === 'mirror' ? bound : key))).toEqual([
      { layerId: '1', action: 'bind', key: 'mirror' },
    ]);
  });

  it('does not prefill filler text and strips the product from the screen', () => {
    const row = composeCreate(layer('1'), 'id', 'investment', 'Investment – Landing page');
    expect(row.id).toBe('');
    expect(row.context.screen).toBe('Landing page');
    expect(screenOf('Split bill / create', 'split-bill')).toBe('create');
    expect(composeCreate(layer('1', { characters: 'Beli emas' }), 'id', 'x', 'F').id).toBe(
      'Beli emas',
    );
  });

  it('gives a variant a new identity that points back to the original', () => {
    const variant = composeVariant(layer('1'), record, 'en');
    expect(variant.copyId).not.toBe(record.copyId);
    expect(variant.baseline?.copyId).toBe(record.copyId);
  });

  it('treats a rename after apply as no canvas change, but new text as one', () => {
    const before = layer('1', { characters: 'Beli' });
    const row = composeCreate(before, 'id', 'investment', 'F');
    const renamed = { ...before, name: 'gopay_investment_buy_cta' };
    expect(rebaseline(row, renamed).canvasFingerprint).toBe(canvasFingerprint(renamed));
    const edited = { ...before, characters: 'Beli sekarang' };
    expect(rebaseline(row, edited).canvasFingerprint).toBe(row.canvasFingerprint);
  });

  it('round-trips picks and drafts, and reads drafts saved by the old Create screen', () => {
    const layers = [layer('1'), layer('2'), layer('3')];
    const compose = composeCreate(layers[0]!, 'id', 'investment', 'F');
    const states = new Map<string, RowState>([
      ['1', { status: 'include', pick: null, unbind: false, shift: 0, compose }],
      ['2', { status: 'include', pick: 'k', unbind: false, shift: 0, compose: null }],
    ]);
    const draft = toDraft({ frameId: 'f', frameName: 'F', locale: 'id', layers, states });
    expect(draft.rows).toHaveLength(1);
    expect(Object.keys(draft.picks!)).toEqual(['1', '2']);
    const restored = fromDraft(draft, layers);
    expect(restored.get('1')?.compose?.copyId).toBe(compose.copyId);
    expect(restored.get('2')?.pick).toBe('k');

    const old: AuthoringDraft = {
      frameId: 'f',
      frameName: 'F',
      locale: 'id',
      rows: [
        { ...compose, layerId: '2', action: 'reuse', copyId: record.copyId, baseline: record },
        { ...compose, layerId: '3', action: 'keep' },
      ],
    };
    const migrated = fromDraft(old, layers);
    expect(migrated.get('2')?.pick).toBe(`registry:${record.copyId}`);
    expect(migrated.has('3')).toBe(false);
  });
});
