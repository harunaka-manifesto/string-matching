import {
  AppError,
  AuthPollResponseSchema,
  AuthStartResponseSchema,
  BackendErrorResponseSchema,
  SheetCopyResponseSchema,
  SheetVerifyResponseSchema,
  SessionResponseSchema,
  type ErrorPayload,
  type AuthPollResponse,
  type AuthStartResponse,
  type SheetCopyResponse,
  type SheetVerifyResponse,
  type SessionResponse,
} from '@ux-copy-sync/contracts';
import { parseSheetCellUrl } from '@ux-copy-sync/contracts';
import { pluginConfig } from './config';

export type PluginFetch = (
  url: string,
  options?: PluginFetchOptions,
) => Promise<PluginFetchResponse>;

function joinBackendUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/${path.replace(/^\/+/, '')}`;
}

function queryValue(value: string): string {
  return encodeURIComponent(value);
}

type BackendSchema = { safeParse: (value: unknown) => unknown };

const INVALID_BACKEND_RESPONSE_MESSAGE =
  'The backend returned an unexpected response. Restart the development backend and try again.';

function backendResponseDiagnostics(
  context: string,
  issues: Array<{ path: Array<string | number>; code: string; validation?: unknown }>,
): void {
  console.error('[UX Copy Sync] Backend response validation failed.', {
    context,
    issues: issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      validation: issue.validation,
    })),
  });
}

export function parseBackendResponse<T>(schema: BackendSchema, value: unknown, context: string): T {
  const parsed = schema.safeParse(value) as
    | { success: true; data: T }
    | {
        success: false;
        error: {
          issues: Array<{ path: Array<string | number>; code: string; validation?: unknown }>;
        };
      };
  if (parsed.success) return parsed.data;
  backendResponseDiagnostics(context, parsed.error.issues);
  throw new AppError('INVALID_BACKEND_RESPONSE', INVALID_BACKEND_RESPONSE_MESSAGE);
}

function validateSheetCopyResponse(
  response: SheetCopyResponse,
  context: string,
): SheetCopyResponse {
  let parsedCell;
  try {
    parsedCell = parseSheetCellUrl(response.source.cellUrl);
  } catch {
    console.error('[UX Copy Sync] Backend Sheet source URL failed semantic validation.', {
      context,
    });
    throw new AppError('INVALID_BACKEND_RESPONSE', INVALID_BACKEND_RESPONSE_MESSAGE);
  }
  if (
    parsedCell.spreadsheetId !== response.source.spreadsheetId ||
    parsedCell.gid !== response.source.sheetId ||
    parsedCell.startCell !== response.source.startCell
  ) {
    console.error('[UX Copy Sync] Backend Sheet source metadata does not match its URL.', {
      context,
    });
    throw new AppError('INVALID_BACKEND_RESPONSE', INVALID_BACKEND_RESPONSE_MESSAGE);
  }
  return response;
}

export function sameOriginUrl(value: string, baseUrl: string): boolean {
  const origin = (input: string): string | undefined => {
    const separator = input.indexOf('://');
    if (separator <= 0) return undefined;
    const authorityStart = separator + 3;
    const pathStart = input.indexOf('/', authorityStart);
    return input.slice(0, pathStart < 0 ? input.length : pathStart).toLowerCase();
  };
  const targetOrigin = origin(value);
  const expectedOrigin = origin(baseUrl);
  return Boolean(targetOrigin && expectedOrigin && targetOrigin === expectedOrigin);
}

export class BackendClient {
  constructor(
    private readonly baseUrl = pluginConfig.backendBaseUrl,
    private readonly getSession: () => Promise<string | undefined> = async () => undefined,
    private readonly fetcher: PluginFetch = (url, options) => fetch(url, options),
  ) {}

  async startAuth(): Promise<AuthStartResponse> {
    return this.request<AuthStartResponse>(
      '/v1/auth/start',
      { method: 'POST' },
      AuthStartResponseSchema,
      false,
    );
  }

  async pollAuth(flowId: string, readKey: string): Promise<AuthPollResponse> {
    const query = `flowId=${queryValue(flowId)}&readKey=${queryValue(readKey)}`;
    return this.request<AuthPollResponse>(
      `/v1/auth/poll?${query}`,
      { method: 'GET' },
      AuthPollResponseSchema,
      false,
    );
  }

  async session(): Promise<SessionResponse> {
    return this.request<SessionResponse>('/v1/session', { method: 'GET' }, SessionResponseSchema);
  }

  async logout(): Promise<void> {
    await this.request('/v1/session/logout', { method: 'POST' }, undefined);
  }

  async disconnect(): Promise<void> {
    await this.request('/v1/session/disconnect', { method: 'POST' }, undefined);
  }

  async copy(cellUrl: string, requestedCount: number): Promise<SheetCopyResponse> {
    const response = await this.request<SheetCopyResponse>(
      '/v1/sheets/copy',
      { method: 'POST', body: JSON.stringify({ cellUrl, requestedCount }) },
      SheetCopyResponseSchema,
    );
    return validateSheetCopyResponse(response, '/v1/sheets/copy');
  }

  async verify(
    cellUrl: string,
    requestedCount: number,
    expectedFingerprint: string,
  ): Promise<SheetVerifyResponse> {
    return this.request<SheetVerifyResponse>(
      '/v1/sheets/verify',
      { method: 'POST', body: JSON.stringify({ cellUrl, requestedCount, expectedFingerprint }) },
      SheetVerifyResponseSchema,
    );
  }

  async publicCopy(cellUrl: string, requestedCount: number): Promise<SheetCopyResponse> {
    const response = await this.request<SheetCopyResponse>(
      '/v1/test/public-sheets/copy',
      { method: 'POST', body: JSON.stringify({ cellUrl, requestedCount }) },
      SheetCopyResponseSchema,
      false,
    );
    return validateSheetCopyResponse(response, '/v1/test/public-sheets/copy');
  }

  async publicVerify(
    cellUrl: string,
    requestedCount: number,
    expectedFingerprint: string,
  ): Promise<SheetVerifyResponse> {
    return this.request<SheetVerifyResponse>(
      '/v1/test/public-sheets/verify',
      { method: 'POST', body: JSON.stringify({ cellUrl, requestedCount, expectedFingerprint }) },
      SheetVerifyResponseSchema,
      false,
    );
  }

  private async request<T>(
    path: string,
    init: PluginFetchOptions,
    schema: BackendSchema | undefined,
    authenticated = true,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Plugin-Version': pluginConfig.pluginVersion,
    };
    if (authenticated) {
      const token = await this.getSession();
      if (!token) throw new AppError('AUTH_REQUIRED', 'Connect your company Google account first.');
      headers.Authorization = `Bearer ${token}`;
    }
    try {
      const response = await this.fetcher(joinBackendUrl(this.baseUrl, path), {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = parseBackendResponse<{ error: ErrorPayload }>(
          BackendErrorResponseSchema,
          body,
          `${path} error response (${response.status})`,
        );
        throw new AppError(
          parsed.error.code,
          parsed.error.message,
          parsed.error.details,
          response.status,
        );
      }
      return schema ? parseBackendResponse(schema, body, `${path} response`) : (undefined as T);
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError(
        'INTERNAL_ERROR',
        'The backend request failed. Check that the backend is running and try again.',
      );
    }
  }
}
