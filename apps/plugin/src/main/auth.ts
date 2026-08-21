import { AppError, type AuthPollResponse, type User } from '@ux-copy-sync/contracts';
import { APP_SESSION_KEY, pluginConfig } from './config';
import { BackendClient, sameOriginUrl } from './backend-client';

type Flow = { flowId: string; readKey: string; expiresAt: string; browserUrl: string };

export class AuthManager {
  private flow: Flow | undefined;
  private runtimeMode: 'authenticated' | 'public-test' | undefined;

  constructor(private readonly client: BackendClient) {}

  async storedSession(): Promise<string | undefined> {
    return figma.clientStorage.getAsync(APP_SESSION_KEY);
  }

  async check(): Promise<{
    authenticated: boolean;
    user?: User;
    mode?: 'authenticated' | 'public-test';
  }> {
    if (this.runtimeMode === 'public-test') return { authenticated: false, mode: 'public-test' };
    const token = await this.storedSession();
    if (!token) return { authenticated: false };
    try {
      const response = await this.client.session();
      return { authenticated: response.authenticated, user: response.user, mode: 'authenticated' };
    } catch (cause) {
      if (
        cause instanceof AppError &&
        (cause.code === 'AUTH_REQUIRED' || cause.code === 'AUTH_RECONNECT_REQUIRED')
      )
        await this.clearSession();
      return { authenticated: false };
    }
  }

  async start(): Promise<Flow> {
    if (this.flow && Date.parse(this.flow.expiresAt) > Date.now()) {
      figma.openExternal(this.flow.browserUrl);
      return this.flow;
    }
    const response = await this.client.startAuth();
    if (!sameOriginUrl(response.browserUrl, pluginConfig.backendBaseUrl))
      throw new AppError(
        'AUTH_FAILED',
        'The sign-in link was not issued by the configured backend.',
      );
    this.flow = {
      flowId: response.flowId,
      readKey: response.readKey,
      expiresAt: response.expiresAt,
      browserUrl: response.browserUrl,
    };
    figma.openExternal(response.browserUrl);
    return this.flow;
  }

  cancel(): void {
    this.flow = undefined;
  }

  async poll(): Promise<AuthPollResponse> {
    if (!this.flow)
      return {
        status: 'failed',
        error: new AppError('AUTH_CANCELLED', 'Sign-in was cancelled.').toPayload(),
      };
    const flow = this.flow;
    const response = await this.client.pollAuth(flow.flowId, flow.readKey);
    if (this.flow?.flowId !== flow.flowId)
      return {
        status: 'failed',
        error: new AppError('AUTH_CANCELLED', 'Sign-in was cancelled.').toPayload(),
      };
    if (response.status === 'complete') {
      await figma.clientStorage.setAsync(APP_SESSION_KEY, response.sessionToken);
      this.flow = undefined;
    } else if (response.status === 'failed') {
      this.flow = undefined;
    }
    return response;
  }

  enterPublicTest(): void {
    if (!pluginConfig.enablePublicTestMode)
      throw new AppError('AUTH_FAILED', 'Public Sheet test mode is disabled in this build.');
    this.runtimeMode = 'public-test';
  }

  exitPublicTest(): void {
    this.runtimeMode = undefined;
  }
  mode(): 'authenticated' | 'public-test' | undefined {
    return this.runtimeMode;
  }

  async clearSession(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      /* local cleanup still matters when backend is unavailable */
    }
    await figma.clientStorage.deleteAsync(APP_SESSION_KEY);
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
    } catch {
      /* local cleanup still matters when the backend is unavailable */
    }
    await figma.clientStorage.deleteAsync(APP_SESSION_KEY);
  }
}
