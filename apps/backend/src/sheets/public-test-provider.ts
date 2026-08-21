import {
  AppError,
  type SheetCopyResponse,
  type SheetVerifyResponse,
} from '@ux-copy-sync/contracts';
import { parseSheetCellUrl } from './parse-source';
import { makeCopyResponse } from './read-copy';

type GvizResponse = {
  status?: string;
  errors?: Array<{ message?: string }>;
  table?: {
    cols?: Array<{ label?: string }>;
    rows?: Array<{ c?: Array<{ v?: unknown; f?: string }> }>;
  };
};

function parseGviz(text: string): GvizResponse {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start)
    throw new AppError('SHEET_ACCESS_DENIED', 'This Sheet is not publicly viewable.');
  try {
    return JSON.parse(text.slice(start + 1, end)) as GvizResponse;
  } catch {
    throw new AppError('SHEET_READ_FAILED', 'Google Sheets returned an invalid public response.');
  }
}

export class PublicSheetProvider {
  constructor(private readonly scanLimit: number) {}

  async copy(cellUrl: string, requestedCount: number): Promise<SheetCopyResponse> {
    const parsed = parseSheetCellUrl(cellUrl);
    const range = `${parsed.columnLabel}${parsed.startRow}:${parsed.columnLabel}${parsed.startRow + this.scanLimit - 1}`;
    const url =
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsed.spreadsheetId)}/gviz/tq` +
      `?gid=${parsed.gid}&range=${encodeURIComponent(range)}&headers=0&tqx=out:json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
      if (!response.ok)
        throw new AppError(
          'SHEET_ACCESS_DENIED',
          'This Sheet must be shared as Anyone with the link: Viewer for test mode.',
        );
      const body = parseGviz(await response.text());
      if (body.status !== 'ok' || !body.table)
        throw new AppError(
          'SHEET_ACCESS_DENIED',
          'This Sheet must be shared as Anyone with the link: Viewer for test mode.',
        );
      const rows = (body.table.rows ?? []).map((row) => {
        const cell = row.c?.[0];
        return cell?.f ?? (cell?.v === undefined || cell?.v === null ? '' : String(cell.v));
      });
      return makeCopyResponse({
        parsed,
        cellUrl,
        requestedCount,
        scanLimit: this.scanLimit,
        values: rows,
        sheetTitle: 'Public Sheet',
      });
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError(
        'SHEET_ACCESS_DENIED',
        'This Sheet must be shared as Anyone with the link: Viewer for test mode.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async verify(
    cellUrl: string,
    requestedCount: number,
    expectedFingerprint: string,
  ): Promise<SheetVerifyResponse> {
    const current = await this.copy(cellUrl, requestedCount);
    return {
      unchanged: current.source.fingerprint === expectedFingerprint,
      currentFingerprint: current.source.fingerprint,
    };
  }
}
