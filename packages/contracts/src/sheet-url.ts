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

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    throw new AppError('SHEET_URL_INVALID', 'The Sheet link contains invalid URL encoding.');
  }
}

function valuesFromPart(part: string, key: string): string[] {
  return part
    .split('&')
    .filter(Boolean)
    .flatMap((item) => {
      const separator = item.indexOf('=');
      const name = decode(separator < 0 ? item : item.slice(0, separator));
      return name === key ? [decode(separator < 0 ? '' : item.slice(separator + 1))] : [];
    });
}

function valuesFromUrl(raw: { query: string; fragment: string }, key: string): string[] {
  return [...valuesFromPart(raw.query, key), ...valuesFromPart(raw.fragment, key)];
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
  const match = input.match(
    /^([A-Za-z][A-Za-z\d+.-]*):\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?(?:#(.*))?$/,
  );
  if (!match) {
    throw new AppError('SHEET_URL_INVALID', 'Paste a complete Google Sheets link to one cell.');
  }
  const protocol = match[1]!.toLowerCase();
  const authority = match[2]!.toLowerCase();
  if (
    protocol !== 'https' ||
    (authority !== 'docs.google.com' && authority !== 'docs.google.com:443')
  ) {
    throw new AppError('SHEET_URL_INVALID', 'Use an HTTPS docs.google.com Google Sheets link.');
  }
  const pathMatch = (match[3] ?? '').match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/);
  if (!pathMatch)
    throw new AppError('SHEET_URL_INVALID', 'This URL is missing a valid spreadsheet ID.');
  const gidText = uniqueOne(
    valuesFromUrl({ query: match[4] ?? '', fragment: match[5] ?? '' }, 'gid'),
    'gid',
  );
  if (!/^\d+$/.test(gidText))
    throw new AppError('SHEET_URL_INVALID', 'The Sheet gid must be numeric.');
  const range = uniqueOne(
    valuesFromUrl({ query: match[4] ?? '', fragment: match[5] ?? '' }, 'range'),
    'range',
  );
  const cell = range.match(/^\$?([A-Za-z]{1,4})\$?([1-9]\d*)$/);
  if (!cell)
    throw new AppError('SHEET_URL_INVALID', 'Paste a link to one cell, such as range=D18.');
  const columnLabel = cell[1]!.toUpperCase();
  const startRow = Number(cell[2]);
  return {
    spreadsheetId: pathMatch[1]!,
    gid: Number(gidText),
    gidText,
    columnLabel,
    columnIndex: columnLabelToIndex(columnLabel),
    startRow,
    startCell: `${columnLabel}${startRow}`,
  };
}
