import { google } from 'googleapis';
import {
  AppError,
  type SheetCopyRequest,
  type SheetCopyResponse,
  type SheetVerifyResponse,
} from '@ux-copy-sync/contracts';
import type { BackendConfig } from '../config';
import type { CredentialStore } from '../sessions/repositories';
import { readPrivateSheet } from './read-copy';
import type { SheetsApiLike } from './read-copy';

export class PrivateSheetsService {
  constructor(
    private readonly config: BackendConfig,
    private readonly credentials: CredentialStore,
  ) {}

  private async apiFor(googleSub: string) {
    const credential = await this.credentials.get(googleSub);
    if (!credential)
      throw new AppError('AUTH_RECONNECT_REQUIRED', 'Google access needs to be connected again.');
    const auth = new google.auth.OAuth2(
      this.config.googleOAuthClientId,
      this.config.googleOAuthClientSecret,
      this.config.googleOAuthRedirectUri,
    );
    auth.setCredentials({ refresh_token: credential.refreshTokenCiphertext });
    return google.sheets({ version: 'v4', auth });
  }

  async copy(googleSub: string, request: SheetCopyRequest): Promise<SheetCopyResponse> {
    try {
      return await readPrivateSheet({
        api: (await this.apiFor(googleSub)) as unknown as SheetsApiLike,
        cellUrl: request.cellUrl,
        requestedCount: request.requestedCount,
        scanLimit: this.config.sheetScanRowLimit,
      });
    } catch (cause) {
      throw cause;
    }
  }

  async verify(googleSub: string, request: SheetVerifyRequestLike): Promise<SheetVerifyResponse> {
    const current = await this.copy(googleSub, request);
    return {
      unchanged: current.source.fingerprint === request.expectedFingerprint,
      currentFingerprint: current.source.fingerprint,
    };
  }
}

type SheetVerifyRequestLike = SheetCopyRequest & { expectedFingerprint: string };
