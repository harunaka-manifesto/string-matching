import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { buildServer } from '../src/server';
import { AuthService } from '../src/auth/service';
import {
  MemoryAuthFlowStore,
  MemoryCredentialStore,
  MemorySessionStore,
} from '../src/sessions/repositories';
import { SessionService } from '../src/sessions/service';
import { PublicSheetProvider } from '../src/sheets/public-test-provider';

function dependencies(config: ReturnType<typeof loadConfig>) {
  const auth = new AuthService(
    config,
    new MemoryAuthFlowStore(),
    new SessionService(new MemorySessionStore(), config.sessionTokenPepper, 7, 30),
    new MemoryCredentialStore(),
    {
      authorizationUrl: () => 'https://backend.test/oauth/start',
      exchange: async () => ({
        claims: {
          sub: 's',
          email: 'writer@company.test',
          email_verified: true,
          hd: 'company.test',
        },
        refreshToken: 'refresh',
      }),
    },
  );
  const response = {
    source: {
      cellUrl: 'https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnopQRS/edit#gid=1&range=D1',
      spreadsheetId: '1abcDEFghiJKLmnopQRS',
      sheetId: 1,
      sheetTitle: 'Copy',
      startCell: 'D1',
      scannedThroughCell: 'D1',
      requestedCount: 1,
      fingerprint: '0'.repeat(64),
    },
    values: [{ id: 'D1', value: 'Copy', row: 1, cell: 'D1' }],
    meta: { requestedCount: 1, returnedCount: 1, scannedRowCount: 1, scanLimitReached: false },
  };
  return {
    auth,
    privateSheets: {
      copy: async () => response,
      verify: async () => ({ unchanged: true, currentFingerprint: response.source.fingerprint }),
    },
    publicSheets: {
      copy: async () => response,
      verify: async () => ({ unchanged: true, currentFingerprint: response.source.fingerprint }),
    } as unknown as PublicSheetProvider,
  };
}

describe('backend routes', () => {
  it('exposes health and omits public test routes when disabled', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      ALLOWED_GOOGLE_WORKSPACE_DOMAIN: 'company.test',
      SESSION_TOKEN_PEPPER: 'test',
    });
    const app = await buildServer({ config, dependencies: dependencies(config) });
    expect((await app.inject('/healthz')).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/test/public-sheets/copy', payload: {} }))
        .statusCode,
    ).toBe(404);
    await app.close();
  });
  it('registers public test routes only when enabled', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      ENABLE_PUBLIC_SHEET_TEST_MODE: 'true',
      ALLOWED_GOOGLE_WORKSPACE_DOMAIN: 'company.test',
      SESSION_TOKEN_PEPPER: 'test',
    });
    const app = await buildServer({ config, dependencies: dependencies(config) });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/test/public-sheets/copy',
          payload: { cellUrl: 'bad', requestedCount: 1 },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });
});
