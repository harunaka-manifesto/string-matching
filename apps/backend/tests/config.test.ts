import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('backend configuration', () => {
  it('rejects malformed numeric values', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/PORT/);
    expect(() => loadConfig({ SHEET_SCAN_ROW_LIMIT: '501' })).toThrow(/SHEET_SCAN_ROW_LIMIT/);
  });

  it('rejects unsafe production configuration', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        SESSION_TOKEN_PEPPER: 'secret',
        ALLOWED_GOOGLE_WORKSPACE_DOMAIN: 'company.test',
        BACKEND_BASE_URL: 'http://backend.test',
        GOOGLE_OAUTH_REDIRECT_URI: 'http://backend.test/oauth/callback',
        GOOGLE_OAUTH_CLIENT_ID: 'client',
        GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
        GOOGLE_CLOUD_PROJECT: 'project',
        GOOGLE_CLOUD_KMS_KEY: 'key',
        ENABLE_PUBLIC_SHEET_TEST_MODE: 'true',
      }),
    ).toThrow(/HTTPS|public Sheet/);
  });
});
