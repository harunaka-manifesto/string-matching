import { describe, expect, it } from 'vitest';
import { buildSequenceSource, prefillSequence, type PrefillRow } from '../src/sequence-prefill';

const variables = [
  { key: 'k-title', name: 'home/title', collection: 'Legacy', order: 3 },
  { key: 'k-body', name: 'home/body', collection: 'Legacy', order: 0 },
  { key: 'k-cta', name: 'shared/cta', collection: 'Legacy', order: 1 },
  { key: 'k-note', name: 'home/note', collection: 'Legacy', order: 2 },
  { key: 'k-other', name: 'home/other', collection: 'Legacy', order: 4 },
  { key: 'n-2', name: 'transfer_b', collection: 'Transfer', order: 1 },
  { key: 'n-1', name: 'transfer_a', collection: 'Transfer', order: 0 },
];

const source = buildSequenceSource({
  orderedNames: {
    HOME: ['home/title', 'home/body', 'shared/cta', 'home/missing', 'home/note', 'shared/cta'],
    OTHER: ['home/other', 'shared/cta'],
  },
  variables,
});

const row = (id: string, patch: Partial<PrefillRow> = {}): PrefillRow => ({
  id,
  excluded: false,
  anchorKey: null,
  shift: 0,
  ...patch,
});

const keys = (result: ReturnType<typeof prefillSequence>) =>
  [...result.values()].map((value) => value?.key ?? null);

describe('buildSequenceSource', () => {
  it('keeps sheet order, drops names missing from the library, and records every position', () => {
    expect(source.sequences.get('sheet:HOME')).toEqual([
      'k-title',
      'k-body',
      'k-cta',
      'k-note',
      'k-cta',
    ]);
    expect(source.positions.get('k-cta')).toHaveLength(3);
  });

  it('orders variables unknown to the sheets by library order per collection', () => {
    expect(source.sequences.get('library:Transfer')).toEqual(['n-1', 'n-2']);
  });
});

describe('prefillSequence', () => {
  it('leaves everything empty until there is an anchor', () => {
    expect(keys(prefillSequence([row('a'), row('b')], source))).toEqual([null, null]);
  });

  it('fills rows after an anchor with the following strings', () => {
    const result = prefillSequence(
      [row('a', { anchorKey: 'k-title' }), row('b'), row('c'), row('d')],
      source,
    );
    expect(keys(result)).toEqual(['k-title', 'k-body', 'k-cta', 'k-note']);
    expect(result.get('a')?.source).toBe('anchor');
    expect(result.get('b')?.source).toBe('sequence');
  });

  it('does not spend a slot on skipped rows, and unskipping reflows', () => {
    const rows = [row('a', { anchorKey: 'k-title' }), row('b', { excluded: true }), row('c')];
    expect(keys(prefillSequence(rows, source))).toEqual(['k-title', null, 'k-body']);
    rows[1] = row('b');
    expect(keys(prefillSequence(rows, source))).toEqual(['k-title', 'k-body', 'k-cta']);
  });

  it('applies shifts from the shifted row down', () => {
    const result = prefillSequence(
      [row('a', { anchorKey: 'k-title' }), row('b', { shift: 1 }), row('c')],
      source,
    );
    expect(keys(result)).toEqual(['k-title', 'k-cta', 'k-note']);
  });

  it('restarts the sequence at each anchor', () => {
    const result = prefillSequence(
      [row('a', { anchorKey: 'k-title' }), row('b'), row('c', { anchorKey: 'k-other' }), row('d')],
      source,
    );
    expect(keys(result)).toEqual(['k-title', 'k-body', 'k-other', 'k-cta']);
  });

  it('continues a shared string from the occurrence after the cursor', () => {
    const result = prefillSequence(
      [row('a', { anchorKey: 'k-note' }), row('b', { anchorKey: 'k-cta' }), row('c')],
      source,
    );
    // k-cta also sits before k-note; the later occurrence is the one on this screen.
    expect(result.get('c')).toBeNull();
    const fromStart = prefillSequence([row('a', { anchorKey: 'k-cta' }), row('b')], source);
    expect(fromStart.get('b')?.key).toBe('k-note');
  });

  it('stops at the end of a sequence instead of crossing into another tab', () => {
    const result = prefillSequence(
      [row('a', { anchorKey: 'k-other' }), row('b'), row('c')],
      source,
    );
    expect(keys(result)).toEqual(['k-other', 'k-cta', null]);
  });

  it('leaves rows empty after an anchor that has no known order', () => {
    const result = prefillSequence([row('a', { anchorKey: 'unknown' }), row('b')], source);
    expect(keys(result)).toEqual(['unknown', null]);
  });
});
