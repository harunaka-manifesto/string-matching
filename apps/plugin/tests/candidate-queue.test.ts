import { describe, expect, it } from 'vitest';
import type { SheetValue } from '@ux-copy-sync/contracts';
import { computePairing, reviewedPairs } from '@ux-copy-sync/domain';
import {
  candidateQueue,
  excludeCandidate,
  moveCandidate,
  restoreCandidateAt,
  restoreCandidateToEnd,
} from '../src/ui/state/candidate-queue';

const values: SheetValue[] = ['A', 'B', 'C', 'D'].map((value, index) => ({
  id: `r${index + 1}`,
  value,
  row: index + 1,
  cell: `C${index + 1}`,
}));

const valuesOf = (items: SheetValue[]) => items.map((item) => item.value);

describe('candidate queue', () => {
  it('starts with all fetched values active and none excluded', () => {
    const state = candidateQueue(values);
    expect(valuesOf(state.active)).toEqual(['A', 'B', 'C', 'D']);
    expect(state.excluded).toEqual([]);
  });

  it('excludes a mapped candidate and preserves the remaining order', () => {
    const state = excludeCandidate(candidateQueue(values), 'r2');
    expect(valuesOf(state.active)).toEqual(['A', 'C', 'D']);
    expect(valuesOf(state.excluded)).toEqual(['B']);
  });

  it('can exclude another candidate after the first exclusion', () => {
    const state = excludeCandidate(excludeCandidate(candidateQueue(values), 'r2'), 'r4');
    expect(valuesOf(state.active)).toEqual(['A', 'C']);
    expect(valuesOf(state.excluded)).toEqual(['B', 'D']);
  });

  it('restores a candidate to the end by default', () => {
    const excluded = excludeCandidate(excludeCandidate(candidateQueue(values), 'r2'), 'r4');
    const state = restoreCandidateToEnd(excluded, 'r2');
    expect(valuesOf(state.active)).toEqual(['A', 'C', 'B']);
    expect(valuesOf(state.excluded)).toEqual(['D']);
  });

  it('restores an excluded candidate at an exact active index', () => {
    const excluded = excludeCandidate(excludeCandidate(candidateQueue(values), 'r2'), 'r4');
    const state = restoreCandidateAt(restoreCandidateToEnd(excluded, 'r2'), 'r4', 1);
    expect(valuesOf(state.active)).toEqual(['A', 'D', 'C', 'B']);
    expect(state.excluded).toEqual([]);
  });

  it('keeps insertion semantics when moving an active candidate', () => {
    const state = moveCandidate(candidateQueue(values), 'r4', 1);
    expect(valuesOf(state.active)).toEqual(['A', 'D', 'B', 'C']);
  });

  it('keeps duplicate values independent by id', () => {
    const duplicateValues = [
      { ...values[0]!, value: 'Same' },
      { ...values[1]!, value: 'Same' },
    ];
    const state = excludeCandidate(candidateQueue(duplicateValues), values[1]!.id);
    expect(state.active.map((item) => item.id)).toEqual(['r1']);
    expect(state.excluded.map((item) => item.id)).toEqual(['r2']);
  });

  it('treats an unknown id as a safe no-op', () => {
    const state = candidateQueue(values);
    expect(excludeCandidate(state, 'missing')).toBe(state);
    expect(moveCandidate(state, 'missing', 1)).toBe(state);
    expect(restoreCandidateToEnd(state, 'missing')).toBe(state);
    expect(restoreCandidateAt(state, 'missing', 1)).toBe(state);
  });

  it('feeds only active candidates into pairing and Apply pairs', () => {
    const targets = [
      { layerId: 't1', layerName: 'One', originalText: 'Old 1', originalName: 'One', included: true },
      { layerId: 't2', layerName: 'Two', originalText: 'Old 2', originalName: 'Two', included: true },
      { layerId: 't3', layerName: 'Three', originalText: 'Old 3', originalName: 'Three', included: true },
    ];
    const state = excludeCandidate(candidateQueue(values), 'r2');

    expect(computePairing(targets, state.active).active.map(({ replacement }) => replacement.value)).toEqual([
      'A',
      'C',
      'D',
    ]);
    expect(reviewedPairs(targets, state.active).map((pair) => pair.replacementId)).toEqual([
      'r1',
      'r3',
      'r4',
    ]);
  });

  it('keeps target Keep current independent from candidate exclusion', () => {
    const targets = [
      { layerId: 't1', layerName: 'One', originalText: 'Old 1', originalName: 'One', included: true },
      { layerId: 't2', layerName: 'Two', originalText: 'Old 2', originalName: 'Two', included: false },
      { layerId: 't3', layerName: 'Three', originalText: 'Old 3', originalName: 'Three', included: true },
    ];
    const state = excludeCandidate(candidateQueue(values.slice(0, 3)), 'r2');

    expect(computePairing(targets, state.active).active.map(({ target, replacement }) => [target.layerId, replacement.value])).toEqual([
      ['t1', 'A'],
      ['t3', 'C'],
    ]);
  });
});
