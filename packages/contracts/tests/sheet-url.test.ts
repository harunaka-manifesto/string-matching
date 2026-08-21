import { describe, expect, it } from 'vitest';
import { AppError, buildFingerprintInput, parseSheetCellUrl } from '../src';

const id = '1abcDEFghiJKLmnopQRS';

describe('parseSheetCellUrl', () => {
  it('accepts gid and range from query and fragment', () => {
    expect(
      parseSheetCellUrl(
        `https://docs.google.com/spreadsheets/d/${id}/edit?gid=123#gid=123&range=%24d%2418`,
      ),
    ).toMatchObject({ gid: 123, startCell: 'D18', columnIndex: 3 });
  });
  it('rejects conflicting duplicate parameters', () => {
    expect(() =>
      parseSheetCellUrl(
        `https://docs.google.com/spreadsheets/d/${id}/edit?gid=123&gid=456&range=D18`,
      ),
    ).toThrow(AppError);
  });
  it.each([
    'https://docs.google.com/spreadsheets/d/short/edit#gid=1&range=D18',
    `https://docs.google.com/spreadsheets/d/${id}/edit#gid=1&range=D18:D20`,
    `https://example.com/spreadsheets/d/${id}/edit#gid=1&range=D18`,
    `https://docs.google.com/spreadsheets/d/${id}/edit#range=D18`,
  ])('rejects invalid source %s', (url) => expect(() => parseSheetCellUrl(url)).toThrow(AppError));
});

describe('source fingerprint input', () => {
  it('is deterministic and preserves exact values', () => {
    const first = buildFingerprintInput({
      spreadsheetId: id,
      sheetId: 1,
      startCell: 'D18',
      requestedCount: 2,
      values: [
        { cell: 'D18', value: 'A' },
        { cell: 'D20', value: ' B ' },
      ],
    });
    const second = buildFingerprintInput({
      spreadsheetId: id,
      sheetId: 1,
      startCell: 'D18',
      requestedCount: 2,
      values: [
        { cell: 'D18', value: 'A' },
        { cell: 'D20', value: ' B ' },
      ],
    });
    expect(first).toBe(second);
  });
});
