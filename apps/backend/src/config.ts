import { AppError } from '@ux-copy-sync/contracts';
import { z } from 'zod';

export type BackendConfig = {
  nodeEnv: string;
  port: number;
  host: string;
  backendBaseUrl: string;
  corsAllowedOrigins: string[];
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

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
    HOST: z.string().min(1).default('127.0.0.1'),
    BACKEND_BASE_URL: z.string().url().default('http://127.0.0.1:8787'),
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('https://www.figma.com,https://figma.com,null')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    ALLOWED_GOOGLE_WORKSPACE_DOMAIN: z.string().default(''),
    ENABLE_PUBLIC_SHEET_TEST_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
    SESSION_TOKEN_PEPPER: z.string().default('local-development-only-pepper'),
    SESSION_IDLE_DAYS: z.coerce.number().positive().default(7),
    SESSION_ABSOLUTE_DAYS: z.coerce.number().positive().default(30),
    SHEET_SCAN_ROW_LIMIT: z.coerce.number().int().min(1).max(500).default(500),
    GOOGLE_CLOUD_PROJECT: z.string().optional(),
    GOOGLE_CLOUD_KMS_KEY: z.string().optional(),
    FIRESTORE_DATABASE: z.string().min(1).default('(default)'),
    PLUGIN_VERSION: z.string().min(1).default('2.2.0'),
  })
  .superRefine((env, context) => {
    if (env.SESSION_ABSOLUTE_DAYS < env.SESSION_IDLE_DAYS)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_ABSOLUTE_DAYS'],
        message: 'must be greater than or equal to SESSION_IDLE_DAYS',
      });
    if (env.NODE_ENV === 'production') {
      if (!env.SESSION_TOKEN_PEPPER || env.SESSION_TOKEN_PEPPER === 'local-development-only-pepper')
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SESSION_TOKEN_PEPPER'],
          message: 'must be provided in production',
        });
      if (!env.ALLOWED_GOOGLE_WORKSPACE_DOMAIN)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ALLOWED_GOOGLE_WORKSPACE_DOMAIN'],
          message: 'must be provided in production',
        });
      if (!env.BACKEND_BASE_URL.startsWith('https://'))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BACKEND_BASE_URL'],
          message: 'must use HTTPS in production',
        });
      if (!env.GOOGLE_OAUTH_REDIRECT_URI?.startsWith('https://'))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_OAUTH_REDIRECT_URI'],
          message: 'must use HTTPS in production',
        });
      if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_OAUTH_CLIENT_ID'],
          message: 'OAuth client ID and secret must be provided in production',
        });
      if (!env.GOOGLE_CLOUD_PROJECT || !env.GOOGLE_CLOUD_KMS_KEY)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_CLOUD_PROJECT'],
          message: 'Google Cloud project and KMS key must be provided in production',
        });
      if (env.ENABLE_PUBLIC_SHEET_TEST_MODE)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ENABLE_PUBLIC_SHEET_TEST_MODE'],
          message: 'public Sheet test mode must be disabled in production',
        });
    }
  });

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new AppError('INTERNAL_ERROR', `Invalid backend configuration: ${details}`);
  }
  const value = parsed.data;
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    backendBaseUrl: value.BACKEND_BASE_URL,
    corsAllowedOrigins: value.CORS_ALLOWED_ORIGINS,
    allowedWorkspaceDomain: value.ALLOWED_GOOGLE_WORKSPACE_DOMAIN,
    enablePublicSheetTestMode: value.ENABLE_PUBLIC_SHEET_TEST_MODE,
    googleOAuthClientId: value.GOOGLE_OAUTH_CLIENT_ID,
    googleOAuthClientSecret: value.GOOGLE_OAUTH_CLIENT_SECRET,
    googleOAuthRedirectUri: value.GOOGLE_OAUTH_REDIRECT_URI,
    sessionTokenPepper: value.SESSION_TOKEN_PEPPER,
    sessionIdleDays: value.SESSION_IDLE_DAYS,
    sessionAbsoluteDays: value.SESSION_ABSOLUTE_DAYS,
    sheetScanRowLimit: value.SHEET_SCAN_ROW_LIMIT,
    googleCloudProject: value.GOOGLE_CLOUD_PROJECT,
    kmsKeyName: value.GOOGLE_CLOUD_KMS_KEY,
    firestoreDatabase: value.FIRESTORE_DATABASE,
    pluginVersion: value.PLUGIN_VERSION,
  };
}
