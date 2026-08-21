import { describe, expect, it } from 'vitest';
import { AppError, buildFingerprintInput, parseSheetCellUrl } from '../src';

const id = '1abcDEFghiJKLmnopQRS';
const exactId = '1Dz1VMHYKaRu8koJbwLq0OkizKVd8pIaOIzNBzRnmn54';
const exactUrl = `https://docs.google.com/spreadsheets/d/${exactId}/edit?gid=1754548139#gid=1754548139&range=C1`;

describe('parseSheetCellUrl', () => {
  it('accepts the exact public test URL and extracts its source identity', () => {
    expect(parseSheetCellUrl(exactUrl)).toMatchObject({
      spreadsheetId: exactId,
      gid: 1754548139,
      startCell: 'C1',
    });
  });

  it('accepts gid only in the fragment', () => {
    expect(
      parseSheetCellUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=123&range=D18`),
    ).toMatchObject({ gid: 123, startCell: 'D18' });
  });

  it('accepts gid in the query with range in the fragment', () => {
    expect(
      parseSheetCellUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?gid=123#range=D18`),
    ).toMatchObject({ gid: 123, startCell: 'D18' });
  });

  it('accepts identical gid values in the query and fragment', () => {
    expect(
      parseSheetCellUrl(
        `https://docs.google.com/spreadsheets/d/${id}/edit?gid=123#gid=123&range=%24d%2418`,
      ),
    ).toMatchObject({ gid: 123, startCell: 'D18', columnIndex: 3 });
  });

  it('rejects conflicting duplicate parameters', () => {
    expect(() =>
      parseSheetCellUrl(
        `https://docs.google.com/spreadsheets/d/${id}/edit?gid=123#gid=456&range=D18`,
      ),
    ).toThrow(AppError);
  });

  it('accepts absolute column and row references and canonicalizes them', () => {
    expect(
      parseSheetCellUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=123&range=%24C%241`),
    ).toMatchObject({ gid: 123, startCell: 'C1' });
  });

  it.each([
    'https://docs.google.com/spreadsheets/d/short/edit#gid=1&range=D18',
    `https://docs.google.com/spreadsheets/d/${id}/edit#gid=1&range=D18:D20`,
    `http://docs.google.com/spreadsheets/d/${id}/edit#gid=1&range=D18`,
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
