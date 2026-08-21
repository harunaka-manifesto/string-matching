import { createHash } from 'node:crypto';
import { buildFingerprintInput, type SheetValue } from '@ux-copy-sync/contracts';

export function sourceFingerprint(input: {
  spreadsheetId: string;
  sheetId: number;
  startCell: string;
  requestedCount: number;
  values: Array<Pick<SheetValue, 'cell' | 'value'>>;
}): string {
  return createHash('sha256').update(buildFingerprintInput(input)).digest('hex');
}
