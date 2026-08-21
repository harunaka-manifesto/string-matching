import type {
  RuntimeMode,
  SheetCopyResponse,
  SheetSource,
  SheetValue,
  SheetVerifyResponse,
} from '@ux-copy-sync/contracts';
import { BackendClient } from './backend-client';

export type SheetSourceProvider = {
  readonly mode: RuntimeMode;
  fetchCopy(input: { cellUrl: string; requestedCount: number }): Promise<SheetCopyResponse>;
  verifyCopy(input: {
    cellUrl: string;
    requestedCount: number;
    expectedFingerprint: string;
  }): Promise<SheetVerifyResponse>;
};

export class AuthenticatedWorkspaceSheetProvider implements SheetSourceProvider {
  readonly mode = 'authenticated' as const;
  constructor(private readonly client: BackendClient) {}
  fetchCopy(input: { cellUrl: string; requestedCount: number }) {
    return this.client.copy(input.cellUrl, input.requestedCount);
  }
  verifyCopy(input: { cellUrl: string; requestedCount: number; expectedFingerprint: string }) {
    return this.client.verify(input.cellUrl, input.requestedCount, input.expectedFingerprint);
  }
}

export class PublicSheetTestProvider implements SheetSourceProvider {
  readonly mode = 'public-test' as const;
  constructor(private readonly client: BackendClient) {}
  fetchCopy(input: { cellUrl: string; requestedCount: number }) {
    return this.client.publicCopy(input.cellUrl, input.requestedCount);
  }
  verifyCopy(input: { cellUrl: string; requestedCount: number; expectedFingerprint: string }) {
    return this.client.publicVerify(input.cellUrl, input.requestedCount, input.expectedFingerprint);
  }
}

export function sourceValues(response: SheetCopyResponse): SheetValue[] {
  return response.values;
}

export function sourceProjection(source: SheetSource): SheetSource {
  return source;
}
