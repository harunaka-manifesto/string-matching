import type { SheetValue } from '@ux-copy-sync/contracts';
import { columnIndexToLabel } from '@ux-copy-sync/contracts';

export const DEFAULT_SCAN_ROW_LIMIT = 500;

export type ScanResult = {
  values: SheetValue[];
  scannedRowCount: number;
  scanLimitReached: boolean;
  scannedThroughCell: string;
};

export function scanNonEmptyValues(input: {
  columnLabel: string;
  startRow: number;
  rows: readonly (string | null | undefined)[];
  requestedCount: number;
  scanLimit?: number;
}): ScanResult {
  const limit = input.scanLimit ?? DEFAULT_SCAN_ROW_LIMIT;
  if (input.requestedCount <= 0)
    return {
      values: [],
      scannedRowCount: 0,
      scanLimitReached: false,
      scannedThroughCell: `${input.columnLabel}${input.startRow}`,
    };
  const values: SheetValue[] = [];
  const physicalRows = Math.min(limit, Math.max(input.rows.length, limit));
  let scannedRowCount = 0;
  for (let index = 0; index < physicalRows; index += 1) {
    scannedRowCount = index + 1;
    const value = String(input.rows[index] ?? '');
    if (value.trim().length > 0) {
      const row = input.startRow + index;
      values.push({
        id: `${input.columnLabel}${row}`,
        value,
        row,
        cell: `${input.columnLabel}${row}`,
      });
      if (values.length >= input.requestedCount) break;
    }
  }
  return {
    values,
    scannedRowCount,
    scanLimitReached: scannedRowCount >= limit && values.length < input.requestedCount,
    scannedThroughCell: `${input.columnLabel}${input.startRow + Math.max(0, scannedRowCount - 1)}`,
  };
}

export function rangeForScan(
  columnLabel: string,
  startRow: number,
  scanLimit = DEFAULT_SCAN_ROW_LIMIT,
): string {
  return `${columnLabel}${startRow}:${columnLabel}${startRow + scanLimit - 1}`;
}

export function lastCellForScan(
  columnIndex: number,
  startRow: number,
  scannedRowCount: number,
): string {
  return `${columnIndexToLabel(columnIndex)}${startRow + Math.max(0, scannedRowCount - 1)}`;
}
