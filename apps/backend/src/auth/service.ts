import { createHash, timingSafeEqual } from 'node:crypto';
import {
  AppError,
  type AuthPollResponse,
  type AuthStartResponse,
  type User,
} from '@ux-copy-sync/contracts';
import type { BackendConfig } from '../config';
import { GoogleOAuthProvider, type OAuthProvider } from './google-oauth';
import { randomSecret, type AuthFlowStore, type CredentialStore } from '../sessions/repositories';
import { SessionService } from '../sessions/service';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
function matchesHash(value: string, expected: string): boolean {
  const actual = Buffer.from(hash(value), 'hex');
  const target = Buffer.from(expected, 'hex');
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export class AuthService {
  constructor(
    private readonly config: BackendConfig,
    private readonly flows: AuthFlowStore,
    private readonly sessions: SessionService,
    private readonly credentials: CredentialStore,
    private readonly oauth: OAuthProvider = new GoogleOAuthProvider(config),
  ) {}

  async start(): Promise<AuthStartResponse> {
    const flowId = randomSecret(24);
    const readKey = randomSecret(32);
    const launchKey = randomSecret(32);
    const state = randomSecret(32);
    const verifier = randomSecret(48);
    const expiresAt = Date.now() + 5 * 60_000;
    let authorizationUrl: string;
    try {
      authorizationUrl = this.oauth.authorizationUrl({
        state,
        codeChallenge: codeChallenge(verifier),
      });
    } catch (cause) {
      throw cause instanceof AppError
        ? cause
        : new AppError('AUTH_FAILED', 'Google OAuth is not configured.');
    }
    const browserUrl = new URL('/oauth/start', this.config.backendBaseUrl);
    browserUrl.searchParams.set('flowId', flowId);
    browserUrl.searchParams.set('launchKey', launchKey);
    await this.flows.create({
      flowId,
      pollSecretHash: hash(readKey),
      launchSecretHash: hash(launchKey),
      stateHash: hash(state),
      codeVerifier: verifier,
      oauthAuthorizationUrl: authorizationUrl,
      createdAt: Date.now(),
      expiresAt,
      purgeAt: expiresAt,
      status: 'pending',
    });
    return {
      flowId,
      readKey,
      browserUrl: browserUrl.toString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async launch(flowId: string, launchKey: string): Promise<string> {
    const flow = await this.flows.byId(flowId);
    if (
      !flow ||
      flow.expiresAt <= Date.now() ||
      !flow.launchSecretHash ||
      !matchesHash(launchKey, flow.launchSecretHash) ||
      flow.status !== 'pending' ||
      !flow.oauthAuthorizationUrl
    )
      throw new AppError('AUTH_FAILED', 'This sign-in link is invalid or has expired.');
    return flow.oauthAuthorizationUrl;
  }

  async cancel(state: string): Promise<boolean> {
    const flow = await this.flows.byStateHash(hash(state));
    if (!flow || flow.expiresAt <= Date.now() || flow.status !== 'pending') return false;
    flow.status = 'failed';
    flow.errorCode = 'AUTH_CANCELLED';
    flow.errorMessage = 'Google sign-in was cancelled. Start again in Figma.';
    await this.flows.update(flow);
    return true;
  }

  async callback(code: string, state: string): Promise<void> {
    const flow = await this.flows.byStateHash(hash(state));
    if (!flow || flow.expiresAt <= Date.now())
      throw new AppError(
        'AUTH_FLOW_EXPIRED',
        'This sign-in request has expired. Start again in Figma.',
      );
    if (flow.status === 'complete' || flow.status === 'consumed') return;
    try {
      const result = await this.oauth.exchange({ code, codeVerifier: flow.codeVerifier });
      const existing = await this.credentials.get(result.claims.sub);
      if (result.refreshToken)
        await this.credentials.save({
          googleSub: result.claims.sub,
          refreshTokenCiphertext: result.refreshToken,
          updatedAt: Date.now(),
        });
      else if (!existing)
        throw new AppError(
          'AUTH_FAILED',
          'Google did not return a refresh token. Reconnect and grant access.',
        );
      const session = await this.sessions.create(result.claims.sub, result.claims.email);
      flow.status = 'complete';
      flow.userSub = result.claims.sub;
      flow.userEmail = result.claims.email;
      flow.completionToken = session.token;
      await this.flows.update(flow);
    } catch (cause) {
      flow.status = 'failed';
      flow.errorCode = cause instanceof AppError ? cause.code : 'AUTH_FAILED';
      flow.errorMessage = cause instanceof Error ? cause.message : 'Google sign-in failed.';
      await this.flows.update(flow);
      throw cause;
    }
  }

  async poll(flowId: string, readKey: string): Promise<AuthPollResponse> {
    const flow = await this.flows.byId(flowId);
    if (!flow || flow.expiresAt <= Date.now())
      return {
        status: 'failed',
        error: new AppError(
          'AUTH_FLOW_EXPIRED',
          'This sign-in request has expired. Start again in Figma.',
        ).toPayload(),
      };
    if (!matchesHash(readKey, flow.pollSecretHash))
      return {
        status: 'failed',
        error: new AppError('AUTH_FAILED', 'The sign-in poll key is invalid.').toPayload(),
      };
    if (flow.status === 'pending') return { status: 'pending' };
    if (flow.status === 'failed')
      return {
        status: 'failed',
        error: new AppError(
          (flow.errorCode as any) ?? 'AUTH_FAILED',
          flow.errorMessage ?? 'Google sign-in failed.',
        ).toPayload(),
      };
    if (flow.status === 'consumed')
      return {
        status: 'failed',
        error: new AppError(
          'AUTH_FLOW_EXPIRED',
          'This sign-in completion has already been consumed.',
        ).toPayload(),
      };
    const consumed = await this.flows.consume(flowId);
    if (!consumed?.completionToken || !consumed.userEmail)
      return {
        status: 'failed',
        error: new AppError(
          'AUTH_FLOW_EXPIRED',
          'This sign-in completion has already been consumed.',
        ).toPayload(),
      };
    const response: AuthPollResponse = {
      status: 'complete',
      sessionToken: consumed.completionToken,
      user: { email: consumed.userEmail },
    };
    return response;
  }

  async userForSession(token: string) {
    return this.sessions.authenticate(token);
  }
  async logout(token: string) {
    await this.sessions.revoke(token);
  }
  async disconnect(token: string) {
    const session = await this.sessions.authenticate(token);
    const credential = await this.credentials.get(session.record.googleSub);
    if (credential && this.oauth.revoke) {
      try {
        await this.oauth.revoke(credential.refreshTokenCiphertext);
      } catch {
        // Local revocation and credential deletion still happen when Google's revoke endpoint is unavailable.
      }
    }
    await this.sessions.revokeUser(session.record.googleSub);
    await this.credentials.delete(session.record.googleSub);
  }
}
