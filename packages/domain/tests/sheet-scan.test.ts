import { describe, expect, it } from 'vitest';
import { scanNonEmptyValues } from '../src/sheet-scan';

describe('scanNonEmptyValues', () => {
  it('skips interior blanks without trimming returned values', () => {
    const result = scanNonEmptyValues({
      columnLabel: 'D',
      startRow: 18,
      rows: ['A', '', '  ', 'B\nC'],
      requestedCount: 3,
    });
    expect(result.values).toEqual([
      { id: 'D18', value: 'A', row: 18, cell: 'D18' },
      { id: 'D21', value: 'B\nC', row: 21, cell: 'D21' },
    ]);
  });

  it('stops at the physical scan limit', () => {
    const result = scanNonEmptyValues({
      columnLabel: 'D',
      startRow: 1,
      rows: [],
      requestedCount: 1,
      scanLimit: 500,
    });
    expect(result.scannedRowCount).toBe(500);
    expect(result.scanLimitReached).toBe(true);
  });
});
