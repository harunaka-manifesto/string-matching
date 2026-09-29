import type { LayerInfo } from '@string-binder/contracts';
import { buildSequenceSource } from '@string-binder/domain';
import { describe, expect, it } from 'vitest';
import { decisionsFor, initialRowState, resolveRows, type RowState } from '../src/ui/frame-rows';

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

const sequences = buildSequenceSource({
  orderedNames: { HOME: ['home/a', 'home/b', 'home/c'] },
  variables: ['a', 'b', 'c'].map((name, order) => ({
    key: `k-${name}`,
    name: `home/${name}`,
    collection: 'Legacy',
    order,
  })),
});

describe('initialRowState', () => {
  it('starts auto-detected non-copy as skipped unless the writer unskipped it before', () => {
    expect(initialRowState(layer('x', { autoSkipReason: 'Time' })).status).toBe('skip');
    expect(initialRowState(layer('x', { autoSkipReason: 'Time', stored: 'include' })).status).toBe(
      'include',
    );
  });

  it('restores stored skips and flags', () => {
    expect(initialRowState(layer('x', { stored: 'skip' })).status).toBe('skip');
    expect(initialRowState(layer('x', { stored: 'needs-new' })).status).toBe('flag');
  });

  it('keeps bound layers included even if they look like non-copy', () => {
    expect(initialRowState(layer('x', { autoSkipReason: 'Time', boundKey: 'k-a' })).status).toBe(
      'include',
    );
  });
});

describe('resolveRows', () => {
  it('uses existing bindings as anchors for the layers below', () => {
    const rows = resolveRows(
      [
        layer('1', { boundKey: 'k-a' }),
        layer('2'),
        layer('3', { autoSkipReason: 'Time' }),
        layer('4'),
      ],
      new Map(),
      sequences,
    );
    expect(rows.map((row) => [row.key, row.source])).toEqual([
      ['k-a', 'existing'],
      ['k-b', 'sequence'],
      [null, 'none'],
      ['k-c', 'sequence'],
    ]);
  });

  it('lets a pick replace an existing binding', () => {
    const states = new Map<string, RowState>([
      ['1', { status: 'include', pick: 'k-b', unbind: false, shift: 0 }],
    ]);
    const rows = resolveRows([layer('1', { boundKey: 'k-a' }), layer('2')], states, sequences);
    expect(rows.map((row) => [row.key, row.source])).toEqual([
      ['k-b', 'picked'],
      ['k-c', 'sequence'],
    ]);
  });
});

describe('decisionsFor', () => {
  it('turns rows into bind, skip, flag, unbind and include decisions', () => {
    const layers = [
      layer('bind', { boundKey: 'k-a' }),
      layer('auto-skip', { autoSkipReason: 'Time' }),
      layer('flag', { stored: 'needs-new' }),
      layer('unbind', { boundKey: 'k-c' }),
      layer('unskipped', { autoSkipReason: 'Date' }),
      layer('plain'),
    ];
    const states = new Map<string, RowState>([
      ['unbind', { status: 'include', pick: null, unbind: true, shift: 0 }],
      ['unskipped', { status: 'include', pick: null, unbind: false, shift: 0 }],
    ]);
    // No sequence continues past the unbound row, so it and the rows after stay empty.
    const noOrder = buildSequenceSource({ orderedNames: {}, variables: [] });
    expect(decisionsFor(resolveRows(layers, states, noOrder))).toEqual([
      { layerId: 'bind', action: 'bind', key: 'k-a' },
      { layerId: 'auto-skip', action: 'skip' },
      { layerId: 'flag', action: 'flag' },
      { layerId: 'unbind', action: 'unbind' },
      { layerId: 'unskipped', action: 'include' },
    ]);
  });
});
