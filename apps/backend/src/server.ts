import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import {
  AppError,
  SheetCopyRequestSchema,
  SheetVerifyRequestSchema,
} from '@ux-copy-sync/contracts';
import type { BackendConfig } from './config';
import {
  GoogleOAuthProvider,
  UnavailableOAuthProvider,
  type OAuthProvider,
} from './auth/google-oauth';
import { AuthService } from './auth/service';
import {
  MemoryAuthFlowStore,
  MemoryCredentialStore,
  MemorySessionStore,
  type AuthFlowStore,
  type CredentialStore,
  type SessionStore,
} from './sessions/repositories';
import { SessionService, type AuthenticatedSession } from './sessions/service';
import { PrivateSheetsService } from './sheets/service';
import { PublicSheetProvider } from './sheets/public-test-provider';
import { GoogleKmsCipher, IdentityCipher, type SecretCipher } from './security/cipher';
import { productionStores } from './sessions/firestore';

export type BackendDependencies = {
  auth: AuthService;
  privateSheets: Pick<PrivateSheetsService, 'copy' | 'verify'>;
  publicSheets: PublicSheetProvider;
};

export type BuildServerOptions = { config?: BackendConfig; dependencies?: BackendDependencies };

type RequestMeta = FastifyRequest & {
  uxRequestId?: string;
  uxStartedAt?: number;
  uxErrorCode?: string;
  uxReturnedCount?: number;
  uxScannedRowCount?: number;
};

function requestId(request: FastifyRequest): string {
  return (request as RequestMeta).uxRequestId ?? crypto.randomUUID();
}

function bearer(request: FastifyRequest): string {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer '))
    throw new AppError('AUTH_REQUIRED', 'Connect your company Google account first.');
  return value.slice('Bearer '.length);
}

async function requireSession(
  request: FastifyRequest,
  auth: AuthService,
): Promise<AuthenticatedSession> {
  return auth.userForSession(bearer(request));
}

function errorResponse(error: unknown, id: string) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError('INTERNAL_ERROR', 'The backend could not complete the request.');
  return {
    status: appError.statusCode >= 500 ? 500 : appError.statusCode,
    body: { error: appError.toPayload(id) },
  };
}

async function defaultDependencies(config: BackendConfig): Promise<BackendDependencies> {
  let flows: AuthFlowStore = new MemoryAuthFlowStore();
  let sessions: SessionStore = new MemorySessionStore();
  let credentials: CredentialStore = new MemoryCredentialStore();
  let cipher: SecretCipher = new IdentityCipher();
  if (config.nodeEnv === 'production') {
    if (!config.googleCloudProject || !config.kmsKeyName)
      throw new AppError(
        'INTERNAL_ERROR',
        'Production Firestore and KMS configuration is incomplete.',
      );
    cipher = new GoogleKmsCipher(config.kmsKeyName);
    const stores = productionStores(config, cipher);
    flows = stores.flows;
    sessions = stores.sessions;
    credentials = stores.credentials;
  }
  const sessionService = new SessionService(
    sessions,
    config.sessionTokenPepper,
    config.sessionIdleDays,
    config.sessionAbsoluteDays,
  );
  const oauth: OAuthProvider =
    config.googleOAuthClientId && config.googleOAuthClientSecret && config.googleOAuthRedirectUri
      ? new GoogleOAuthProvider(config)
      : new UnavailableOAuthProvider();
  return {
    auth: new AuthService(config, flows, sessionService, credentials, oauth),
    privateSheets: new PrivateSheetsService(config, credentials),
    publicSheets: new PublicSheetProvider(config.sheetScanRowLimit),
  };
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? (await import('./config')).loadConfig();
  const dependencies = options.dependencies ?? (await defaultDependencies(config));
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'test' ? 'silent' : 'info',
      redact: ['req.headers.authorization', 'req.url', 'res.headers["set-cookie"]'],
    },
    bodyLimit: 64 * 1024,
    requestIdHeader: 'x-request-id',
  });
  await app.register(rateLimit, { global: false, max: 30, timeWindow: '1 minute' });
  app.addHook('onRequest', async (request, reply) => {
    const meta = request as RequestMeta;
    meta.uxRequestId = crypto.randomUUID();
    meta.uxStartedAt = Date.now();
    const id = requestId(request);
    reply.header('X-Request-Id', id);
  });
  app.addHook('onResponse', async (request, reply) => {
    const meta = request as RequestMeta;
    request.log.info(
      {
        requestId: requestId(request),
        route: request.routeOptions.url,
        status: reply.statusCode,
        durationMs: Date.now() - (meta.uxStartedAt ?? Date.now()),
        pluginVersion:
          typeof request.headers['x-plugin-version'] === 'string'
            ? request.headers['x-plugin-version'].slice(0, 64)
            : undefined,
        errorCode: meta.uxErrorCode,
        returnedCount: meta.uxReturnedCount,
        scannedRowCount: meta.uxScannedRowCount,
      },
      'request complete',
    );
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async () => ({
    ok: true,
    publicSheetTestMode: config.enablePublicSheetTestMode,
  }));

  app.post(
    '/v1/auth/start',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const result = await dependencies.auth.start();
      return reply.send(result);
    },
  );
  app.get(
    '/v1/auth/poll',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const query = request.query as { flowId?: string; readKey?: string };
      if (!query.flowId || !query.readKey)
        throw new AppError('INVALID_REQUEST', 'flowId and readKey are required.');
      return reply.send(await dependencies.auth.poll(query.flowId, query.readKey));
    },
  );
  app.get('/oauth/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const browserReply = () =>
      reply
        .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
        .header('Referrer-Policy', 'no-referrer')
        .type('text/html');
    if (query.error)
      return browserReply().send(
        '<!doctype html><title>UX Copy Sync</title><p>Google sign-in was cancelled. Return to Figma and try again.</p>',
      );
    if (!query.code || !query.state)
      throw new AppError('AUTH_FAILED', 'Google sign-in callback was incomplete.');
    await dependencies.auth.callback(query.code, query.state);
    return browserReply().send(
      '<!doctype html><title>UX Copy Sync</title><p>Google is connected. Return to Figma to continue.</p>',
    );
  });
  app.get('/v1/session', async (request, reply) => {
    const session = await requireSession(request, dependencies.auth);
    return reply.send({ authenticated: true, user: { email: session.record.email } });
  });
  app.post('/v1/session/logout', async (request, reply) => {
    await dependencies.auth.logout(bearer(request));
    return reply.code(204).send();
  });
  app.post('/v1/session/disconnect', async (request, reply) => {
    await dependencies.auth.disconnect(bearer(request));
    return reply.code(204).send();
  });

  app.post(
    '/v1/sheets/copy',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const session = await requireSession(request, dependencies.auth);
      const input = SheetCopyRequestSchema.parse(request.body);
      const result = await dependencies.privateSheets.copy(session.record.googleSub, input);
      const meta = request as RequestMeta;
      meta.uxReturnedCount = result.meta.returnedCount;
      meta.uxScannedRowCount = result.meta.scannedRowCount;
      return reply.send(result);
    },
  );
  app.post(
    '/v1/sheets/verify',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const session = await requireSession(request, dependencies.auth);
      const input = SheetVerifyRequestSchema.parse(request.body);
      return reply.send(await dependencies.privateSheets.verify(session.record.googleSub, input));
    },
  );
  if (config.enablePublicSheetTestMode) {
    app.post(
      '/v1/test/public-sheets/copy',
      { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const input = SheetCopyRequestSchema.parse(request.body);
        const result = await dependencies.publicSheets.copy(input.cellUrl, input.requestedCount);
        const meta = request as RequestMeta;
        meta.uxReturnedCount = result.meta.returnedCount;
        meta.uxScannedRowCount = result.meta.scannedRowCount;
        return reply.send(result);
      },
    );
    app.post(
      '/v1/test/public-sheets/verify',
      { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const input = SheetVerifyRequestSchema.parse(request.body);
        return reply.send(
          await dependencies.publicSheets.verify(
            input.cellUrl,
            input.requestedCount,
            input.expectedFingerprint,
          ),
        );
      },
    );
  }

  app.setErrorHandler((error, request, reply) => {
    const id = requestId(request);
    const statusCode = (error as { statusCode?: number }).statusCode;
    const mapped =
      error instanceof AppError
        ? error
        : error instanceof Error && error.name === 'ZodError'
          ? new AppError('INVALID_REQUEST', 'The request was invalid.')
          : statusCode === 400 || statusCode === 413
            ? new AppError('INVALID_REQUEST', 'The request was invalid.', undefined, statusCode)
            : statusCode === 429
              ? new AppError(
                  'SHEET_RATE_LIMITED',
                  'Too many requests. Try again shortly.',
                  undefined,
                  429,
                )
              : error;
    const response = errorResponse(mapped, id);
    (request as RequestMeta).uxErrorCode = response.body.error.code;
    reply.code(response.status).send(response.body);
  });
  return app;
}

export async function startServer(config?: BackendConfig): Promise<FastifyInstance> {
  const app = await buildServer({ config });
  const actual = config ?? (await import('./config')).loadConfig();
  await app.listen({ port: actual.port, host: actual.host });
  return app;
}

if (process.argv[1]?.endsWith('/server.js') || process.argv[1]?.endsWith('/server.cjs'))
  void startServer();
