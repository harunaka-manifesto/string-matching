import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { AuthService } from '../src/auth/service';
import {
  MemoryAuthFlowStore,
  MemoryCredentialStore,
  MemorySessionStore,
} from '../src/sessions/repositories';
import { SessionService } from '../src/sessions/service';

const oauth = {
  authorizationUrl: () => 'https://backend.test/oauth/start',
  exchange: async () => ({
    claims: {
      sub: 'sub-1',
      email: 'writer@company.test',
      email_verified: true,
      hd: 'company.test',
    },
    refreshToken: 'encrypted-in-test-double',
  }),
};

describe('auth flow', () => {
  it('poll completion is one-time consumable', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      ALLOWED_GOOGLE_WORKSPACE_DOMAIN: 'company.test',
      BACKEND_BASE_URL: 'https://backend.test',
      SESSION_TOKEN_PEPPER: 'test-pepper',
    });
    const flows = new MemoryAuthFlowStore();
    const sessions = new SessionService(new MemorySessionStore(), 'test-pepper', 7, 30);
    const auth = new AuthService(config, flows, sessions, new MemoryCredentialStore(), oauth);
    const readKey = 'poll-secret';
    await flows.create({
      flowId: 'flow-1',
      pollSecretHash: createHash('sha256').update(readKey).digest('hex'),
      stateHash: 'state',
      codeVerifier: 'verifier',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      status: 'complete',
      completionToken: 'session-token',
      userEmail: 'writer@company.test',
      userSub: 'sub-1',
    });
    const [first, second] = await Promise.all([
      auth.poll('flow-1', readKey),
      auth.poll('flow-1', readKey),
    ]);
    expect([first, second].filter((result) => result.status === 'complete')).toHaveLength(1);
    expect([first, second].find((result) => result.status === 'complete')).toMatchObject({
      status: 'complete',
      sessionToken: 'session-token',
    });
    expect((await auth.poll('flow-1', readKey)).status).toBe('failed');
  });
});
