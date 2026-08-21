import { AppError } from './errors';

export type ParsedSheetCell = {
  spreadsheetId: string;
  gid: number;
  gidText: string;
  columnLabel: string;
  columnIndex: number;
  startRow: number;
  startCell: string;
};

function valuesFromUrl(raw: URL, key: string): string[] {
  const values = [...raw.searchParams.getAll(key)];
  const fragment = raw.hash.replace(/^#/, '');
  if (fragment) values.push(...new URLSearchParams(fragment).getAll(key));
  return values;
}

function uniqueOne(values: string[], label: string): string {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length !== 1)
    throw new AppError('SHEET_URL_INVALID', `The URL must include one ${label}.`);
  return unique[0]!;
}

export function columnLabelToIndex(label: string): number {
  let index = 0;
  for (const character of label) index = index * 26 + character.charCodeAt(0) - 64;
  return index - 1;
}

export function columnIndexToLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('Column index must be non-negative.');
  let value = index + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function parseSheetCellUrl(input: string): ParsedSheetCell {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('SHEET_URL_INVALID', 'Paste a complete Google Sheets link to one cell.');
  }
  if (url.hostname !== 'docs.google.com' || url.protocol !== 'https:') {
    throw new AppError('SHEET_URL_INVALID', 'Use an HTTPS docs.google.com Google Sheets link.');
  }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/);
  if (!match)
    throw new AppError('SHEET_URL_INVALID', 'This URL is missing a valid spreadsheet ID.');
  const gidText = uniqueOne(valuesFromUrl(url, 'gid'), 'gid');
  if (!/^\d+$/.test(gidText))
    throw new AppError('SHEET_URL_INVALID', 'The Sheet gid must be numeric.');
  const range = uniqueOne(valuesFromUrl(url, 'range'), 'range');
  const cell = range.match(/^\$?([A-Za-z]{1,4})\$?([1-9]\d*)$/);
  if (!cell)
    throw new AppError('SHEET_URL_INVALID', 'Paste a link to one cell, such as range=D18.');
  const columnLabel = cell[1]!.toUpperCase();
  const startRow = Number(cell[2]);
  return {
    spreadsheetId: match[1]!,
    gid: Number(gidText),
    gidText,
    columnLabel,
    columnIndex: columnLabelToIndex(columnLabel),
    startRow,
    startCell: `${columnLabel}${startRow}`,
  };
}
