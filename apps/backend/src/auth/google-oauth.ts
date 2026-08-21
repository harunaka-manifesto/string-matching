import { google } from 'googleapis';
import { CodeChallengeMethod } from 'google-auth-library';
import { AppError } from '@ux-copy-sync/contracts';
import {
  assertAllowedWorkspaceIdentity,
  type GoogleIdentityClaims,
} from '../security/domain-policy';
import type { BackendConfig } from '../config';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

export type OAuthExchange = { claims: GoogleIdentityClaims; refreshToken?: string };

export interface OAuthProvider {
  authorizationUrl(input: { state: string; codeChallenge: string }): string;
  exchange(input: { code: string; codeVerifier: string }): Promise<OAuthExchange>;
  revoke?(refreshToken: string): Promise<void>;
}

export class UnavailableOAuthProvider implements OAuthProvider {
  authorizationUrl(): string {
    throw new AppError('AUTH_FAILED', 'Google OAuth is not configured on this backend.');
  }
  async exchange(): Promise<OAuthExchange> {
    throw new AppError('AUTH_FAILED', 'Google OAuth is not configured on this backend.');
  }
  async revoke(): Promise<void> {
    return undefined;
  }
}

export class GoogleOAuthProvider implements OAuthProvider {
  private readonly client;
  constructor(private readonly config: BackendConfig) {
    if (
      !config.googleOAuthClientId ||
      !config.googleOAuthClientSecret ||
      !config.googleOAuthRedirectUri
    )
      throw new AppError('AUTH_FAILED', 'Google OAuth is not configured on this backend.');
    this.client = new google.auth.OAuth2(
      config.googleOAuthClientId,
      config.googleOAuthClientSecret,
      config.googleOAuthRedirectUri,
    );
  }
  authorizationUrl(input: { state: string; codeChallenge: string }): string {
    return this.client.generateAuthUrl({
      access_type: 'offline',
      include_granted_scopes: true,
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state: input.state,
      hd: this.config.allowedWorkspaceDomain,
      code_challenge: input.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
  }
  async exchange(input: { code: string; codeVerifier: string }): Promise<OAuthExchange> {
    const { tokens } = await this.client.getToken({
      code: input.code,
      codeVerifier: input.codeVerifier,
    });
    if (!tokens.id_token)
      throw new AppError('AUTH_FAILED', 'Google did not return a verified identity token.');
    const ticket = await this.client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.config.googleOAuthClientId,
    });
    const claims = ticket.getPayload() as GoogleIdentityClaims | undefined;
    if (!claims) throw new AppError('AUTH_FAILED', 'Google identity verification failed.');
    assertAllowedWorkspaceIdentity(
      claims,
      this.config.allowedWorkspaceDomain,
      this.config.googleOAuthClientId,
    );
    return { claims, refreshToken: tokens.refresh_token ?? undefined };
  }
  async revoke(refreshToken: string): Promise<void> {
    await this.client.revokeToken(refreshToken);
  }
}
