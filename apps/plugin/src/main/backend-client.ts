import {
  AppError,
  AuthPollResponseSchema,
  AuthStartResponseSchema,
  BackendErrorResponseSchema,
  SheetCopyResponseSchema,
  SheetVerifyResponseSchema,
  SessionResponseSchema,
  type AuthPollResponse,
  type AuthStartResponse,
  type SheetCopyResponse,
  type SheetVerifyResponse,
  type SessionResponse,
} from '@ux-copy-sync/contracts';
import { pluginConfig } from './config';

export class BackendClient {
  constructor(
    private readonly baseUrl = pluginConfig.backendBaseUrl,
    private readonly getSession: () => Promise<string | undefined> = async () => undefined,
  ) {}

  async startAuth(): Promise<AuthStartResponse> {
    return this.request('/v1/auth/start', { method: 'POST' }, AuthStartResponseSchema);
  }

  async pollAuth(flowId: string, readKey: string): Promise<AuthPollResponse> {
    const query = new URLSearchParams({ flowId, readKey });
    return this.request(
      `/v1/auth/poll?${query.toString()}`,
      { method: 'GET' },
      AuthPollResponseSchema,
      false,
    );
  }

  async session(): Promise<SessionResponse> {
    return this.request('/v1/session', { method: 'GET' }, SessionResponseSchema);
  }

  async logout(): Promise<void> {
    await this.request('/v1/session/logout', { method: 'POST' }, undefined);
  }

  async disconnect(): Promise<void> {
    await this.request('/v1/session/disconnect', { method: 'POST' }, undefined);
  }

  async copy(cellUrl: string, requestedCount: number): Promise<SheetCopyResponse> {
    return this.request(
      '/v1/sheets/copy',
      { method: 'POST', body: JSON.stringify({ cellUrl, requestedCount }) },
      SheetCopyResponseSchema,
    );
  }

  async verify(
    cellUrl: string,
    requestedCount: number,
    expectedFingerprint: string,
  ): Promise<SheetVerifyResponse> {
    return this.request(
      '/v1/sheets/verify',
      { method: 'POST', body: JSON.stringify({ cellUrl, requestedCount, expectedFingerprint }) },
      SheetVerifyResponseSchema,
    );
  }

  async publicCopy(cellUrl: string, requestedCount: number): Promise<SheetCopyResponse> {
    return this.request(
      '/v1/test/public-sheets/copy',
      { method: 'POST', body: JSON.stringify({ cellUrl, requestedCount }) },
      SheetCopyResponseSchema,
      false,
    );
  }

  async publicVerify(
    cellUrl: string,
    requestedCount: number,
    expectedFingerprint: string,
  ): Promise<SheetVerifyResponse> {
    return this.request(
      '/v1/test/public-sheets/verify',
      { method: 'POST', body: JSON.stringify({ cellUrl, requestedCount, expectedFingerprint }) },
      SheetVerifyResponseSchema,
      false,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    schema: { parse: (value: unknown) => T } | undefined,
    authenticated = true,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const headers = new Headers(init.headers);
      headers.set('Content-Type', 'application/json');
      headers.set('X-Plugin-Version', pluginConfig.pluginVersion);
      if (authenticated) {
        const token = await this.getSession();
        if (!token)
          throw new AppError('AUTH_REQUIRED', 'Connect your company Google account first.');
        headers.set('Authorization', `Bearer ${token}`);
      }
      const response = await fetch(new URL(path, this.baseUrl).toString(), {
        ...init,
        headers,
        signal: controller.signal,
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = BackendErrorResponseSchema.safeParse(body);
        if (parsed.success)
          throw new AppError(
            parsed.data.error.code,
            parsed.data.error.message,
            parsed.data.error.details,
            response.status,
          );
        throw new AppError(
          'INTERNAL_ERROR',
          `Backend request failed (${response.status}).`,
          undefined,
          response.status,
        );
      }
      return schema ? schema.parse(body) : (undefined as T);
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      if (cause instanceof DOMException && cause.name === 'AbortError')
        throw new AppError('SHEET_READ_FAILED', 'The backend request timed out. Try again.');
      throw new AppError(
        'SHEET_READ_FAILED',
        cause instanceof Error ? cause.message : 'The backend request failed.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
