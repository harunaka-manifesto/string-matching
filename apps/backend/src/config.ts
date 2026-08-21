import { AppError } from '@ux-copy-sync/contracts';

export type BackendConfig = {
  nodeEnv: string;
  port: number;
  host: string;
  backendBaseUrl: string;
  allowedWorkspaceDomain: string;
  enablePublicSheetTestMode: boolean;
  googleOAuthClientId?: string;
  googleOAuthClientSecret?: string;
  googleOAuthRedirectUri?: string;
  sessionTokenPepper: string;
  sessionIdleDays: number;
  sessionAbsoluteDays: number;
  sheetScanRowLimit: number;
  googleCloudProject?: string;
  kmsKeyName?: string;
  firestoreDatabase: string;
  pluginVersion: string;
};

function bool(value: string | undefined, fallback = false): boolean {
  return value === undefined ? fallback : value.toLowerCase() === 'true';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const pepper = env.SESSION_TOKEN_PEPPER;
  if (!pepper && nodeEnv === 'production')
    throw new AppError('INTERNAL_ERROR', 'SESSION_TOKEN_PEPPER must be provided in production.');
  if (!env.ALLOWED_GOOGLE_WORKSPACE_DOMAIN && nodeEnv === 'production')
    throw new AppError(
      'INTERNAL_ERROR',
      'ALLOWED_GOOGLE_WORKSPACE_DOMAIN must be provided in production.',
    );
  if (
    nodeEnv === 'production' &&
    (!env.GOOGLE_OAUTH_CLIENT_ID ||
      !env.GOOGLE_OAUTH_CLIENT_SECRET ||
      !env.GOOGLE_OAUTH_REDIRECT_URI)
  )
    throw new AppError('INTERNAL_ERROR', 'Google OAuth configuration is incomplete in production.');
  return {
    nodeEnv,
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '127.0.0.1',
    backendBaseUrl: env.BACKEND_BASE_URL ?? 'http://127.0.0.1:8787',
    allowedWorkspaceDomain: env.ALLOWED_GOOGLE_WORKSPACE_DOMAIN ?? '',
    enablePublicSheetTestMode: bool(env.ENABLE_PUBLIC_SHEET_TEST_MODE),
    googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID,
    googleOAuthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    googleOAuthRedirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
    sessionTokenPepper: pepper ?? 'local-development-only-pepper',
    sessionIdleDays: Number(env.SESSION_IDLE_DAYS ?? 7),
    sessionAbsoluteDays: Number(env.SESSION_ABSOLUTE_DAYS ?? 30),
    sheetScanRowLimit: Math.min(500, Math.max(1, Number(env.SHEET_SCAN_ROW_LIMIT ?? 500))),
    googleCloudProject: env.GOOGLE_CLOUD_PROJECT,
    kmsKeyName: env.GOOGLE_CLOUD_KMS_KEY,
    firestoreDatabase: env.FIRESTORE_DATABASE ?? '(default)',
    pluginVersion: env.PLUGIN_VERSION ?? '2.2.0',
  };
}
