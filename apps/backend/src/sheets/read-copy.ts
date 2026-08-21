import { AppError, type SheetCopyResponse, type SheetValue } from '@ux-copy-sync/contracts';
import { rangeForScan, scanNonEmptyValues } from '@ux-copy-sync/domain';
import { parseSheetCellUrl, type ParsedSheetCell } from './parse-source';
import { sourceFingerprint } from './fingerprint';
import { withGoogleRetry } from './retry';

export type SheetsApiLike = {
  spreadsheets: {
    get: (input: { spreadsheetId: string; fields: string }) => Promise<{
      data: {
        properties?: { title?: string };
        sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
      };
    }>;
    values: {
      get: (input: {
        spreadsheetId: string;
        range: string;
        valueRenderOption: string;
      }) => Promise<{ data: { values?: unknown[][] } }>;
    };
  };
};

export function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export async function readPrivateSheet(input: {
  api: SheetsApiLike;
  cellUrl: string;
  requestedCount: number;
  scanLimit: number;
  retry?: typeof withGoogleRetry;
}): Promise<SheetCopyResponse> {
  const parsed = parseSheetCellUrl(input.cellUrl);
  const deadlineAt = Date.now() + 17_000;
  const retry =
    input.retry ?? ((operation) => withGoogleRetry(operation, { attempts: 3, deadlineAt }));
  const timeoutMs = () => Math.max(1, Math.min(7_000, deadlineAt - Date.now()));
  let metadata: Awaited<ReturnType<SheetsApiLike['spreadsheets']['get']>>;
  try {
    metadata = await retry(() =>
      withTimeout(
        input.api.spreadsheets.get({
          spreadsheetId: parsed.spreadsheetId,
          fields: 'properties(title),sheets(properties(sheetId,title))',
        }),
        timeoutMs(),
      ),
    );
  } catch (cause) {
    throw mapGoogleError(cause, 'Could not read this Google Sheet.');
  }
  const sheet = metadata.data.sheets?.find((item) => item.properties?.sheetId === parsed.gid);
  if (!sheet?.properties?.title)
    throw new AppError('SHEET_TAB_NOT_FOUND', 'The Sheet tab in this link no longer exists.');
  const title = sheet.properties.title;
  const range = `${quoteSheetTitle(title)}!${rangeForScan(parsed.columnLabel, parsed.startRow, input.scanLimit)}`;
  let valuesResponse: Awaited<ReturnType<SheetsApiLike['spreadsheets']['values']['get']>>;
  try {
    valuesResponse = await retry(() =>
      withTimeout(
        input.api.spreadsheets.values.get({
          spreadsheetId: parsed.spreadsheetId,
          range,
          valueRenderOption: 'FORMATTED_VALUE',
        }),
        timeoutMs(),
      ),
    );
  } catch (cause) {
    throw mapGoogleError(cause, 'Could not read copy from this Google Sheet.');
  }
  const rows = (valuesResponse.data.values ?? []).map((row) => String(row?.[0] ?? ''));
  return makeCopyResponse({
    parsed,
    cellUrl: input.cellUrl,
    requestedCount: input.requestedCount,
    scanLimit: input.scanLimit,
    values: rows,
    sheetTitle: title,
    spreadsheetTitle: metadata.data.properties?.title,
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new AppError('SHEET_READ_FAILED', 'Google Sheets did not respond in time.')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function makeCopyResponse(input: {
  parsed: ParsedSheetCell;
  cellUrl: string;
  requestedCount: number;
  scanLimit: number;
  values: readonly (string | null | undefined)[];
  sheetTitle: string;
  spreadsheetTitle?: string;
}): SheetCopyResponse {
  const scan = scanNonEmptyValues({
    columnLabel: input.parsed.columnLabel,
    startRow: input.parsed.startRow,
    rows: input.values,
    requestedCount: input.requestedCount,
    scanLimit: input.scanLimit,
  });
  const fingerprint = sourceFingerprint({
    spreadsheetId: input.parsed.spreadsheetId,
    sheetId: input.parsed.gid,
    startCell: input.parsed.startCell,
    requestedCount: input.requestedCount,
    values: scan.values,
  });
  return {
    source: {
      cellUrl: input.cellUrl,
      spreadsheetId: input.parsed.spreadsheetId,
      spreadsheetTitle: input.spreadsheetTitle,
      sheetId: input.parsed.gid,
      sheetTitle: input.sheetTitle,
      startCell: input.parsed.startCell,
      scannedThroughCell: scan.scannedThroughCell,
      requestedCount: input.requestedCount,
      fingerprint,
    },
    values: scan.values,
    meta: {
      requestedCount: input.requestedCount,
      returnedCount: scan.values.length,
      scannedRowCount: scan.scannedRowCount,
      scanLimitReached: scan.scanLimitReached,
    },
  };
}

export function mapGoogleError(cause: unknown, fallback: string): AppError {
  const status =
    (cause as { response?: { status?: number }; code?: number })?.response?.status ??
    (cause as { code?: number })?.code;
  if (status === 401)
    return new AppError('AUTH_RECONNECT_REQUIRED', 'Google access needs to be connected again.');
  if (status === 403)
    return new AppError(
      'SHEET_ACCESS_DENIED',
      'You do not have access to this Sheet with the connected Google account.',
    );
  if (status === 404)
    return new AppError('SHEET_NOT_FOUND', 'The linked Google Sheet could not be found.');
  if (status === 429)
    return new AppError(
      'SHEET_RATE_LIMITED',
      'Google Sheets is temporarily rate limited. Try again shortly.',
    );
  return cause instanceof AppError ? cause : new AppError('SHEET_READ_FAILED', fallback);
}
