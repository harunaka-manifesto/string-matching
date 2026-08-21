import { describe, expect, it } from 'vitest';
import { computePairing, moveReplacement, pairingStats, reviewedPairs } from '../src/pairing';

const targets = [
  { layerId: 't1', layerName: 'One', originalText: 'Old 1', originalName: 'One', included: true },
  { layerId: 't2', layerName: 'Two', originalText: 'Old 2', originalName: 'Two', included: true },
  {
    layerId: 't3',
    layerName: 'Three',
    originalText: 'Old 3',
    originalName: 'Three',
    included: true,
  },
];
const replacements = ['A', 'B', 'C', 'D'].map((value, index) => ({
  id: `r${index + 1}`,
  value,
  row: index + 1,
  cell: `D${index + 1}`,
}));

describe('pairing', () => {
  it('pairs sequentially and leaves excess values unassigned', () => {
    const result = computePairing(targets, replacements);
    expect(result.active.map(({ replacement }) => replacement.value)).toEqual(['A', 'B', 'C']);
    expect(result.unassigned.map((replacement) => replacement.value)).toEqual(['D']);
  });

  it('skip does not consume a Sheet string', () => {
    const result = computePairing(
      [{ ...targets[0]! }, { ...targets[1]!, included: false }, targets[2]!],
      replacements,
    );
    expect(
      result.active.map(({ target, replacement }) => [target.layerId, replacement.value]),
    ).toEqual([
      ['t1', 'A'],
      ['t3', 'B'],
    ]);
  });

  it('uses insert behavior for drag reorder', () => {
    expect(moveReplacement(replacements, 'r4', 1).map((value) => value.value)).toEqual([
      'A',
      'D',
      'B',
      'C',
    ]);
    expect(moveReplacement(replacements, 'r1', 3).map((value) => value.value)).toEqual([
      'B',
      'C',
      'D',
      'A',
    ]);
  });

  it('keeps duplicate values independent by id', () => {
    const duplicate = [
      { ...replacements[0]!, value: 'Same' },
      { ...replacements[1]!, value: 'Same' },
    ];
    expect(reviewedPairs(targets, duplicate).map((pair) => pair.replacementId)).toEqual([
      'r1',
      'r2',
    ]);
  });

  it('counts a rename-only pair as a change', () => {
    const value = [{ id: 'r1', value: 'Old 1', row: 1, cell: 'D1' }];
    expect(pairingStats([{ ...targets[0]!, originalName: 'Other' }], value)).toMatchObject({
      changed: 1,
    });
  });
});
