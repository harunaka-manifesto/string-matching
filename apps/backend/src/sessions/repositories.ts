import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type AuthFlow = {
  flowId: string;
  pollSecretHash: string;
  stateHash: string;
  codeVerifier: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'complete' | 'consumed' | 'failed';
  userSub?: string;
  userEmail?: string;
  completionToken?: string;
  completionTokenCiphertext?: string;
  codeVerifierCiphertext?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type SessionRecord = {
  tokenHash: string;
  googleSub: string;
  email: string;
  createdAt: number;
  lastUsedAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  revokedAt?: number;
};

export type CredentialRecord = {
  googleSub: string;
  refreshTokenCiphertext: string;
  updatedAt: number;
};

export interface AuthFlowStore {
  create(flow: AuthFlow): Promise<void>;
  byId(flowId: string): Promise<AuthFlow | undefined>;
  byStateHash(stateHash: string): Promise<AuthFlow | undefined>;
  update(flow: AuthFlow): Promise<void>;
  consume(flowId: string): Promise<AuthFlow | undefined>;
}
export interface SessionStore {
  save(session: SessionRecord): Promise<void>;
  byTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  revoke(tokenHash: string): Promise<void>;
  revokeForUser(googleSub: string): Promise<void>;
}
export interface CredentialStore {
  get(googleSub: string): Promise<CredentialRecord | undefined>;
  save(record: CredentialRecord): Promise<void>;
  delete(googleSub: string): Promise<void>;
}

export class MemoryAuthFlowStore implements AuthFlowStore {
  private readonly records = new Map<string, AuthFlow>();
  async create(flow: AuthFlow) {
    this.records.set(flow.flowId, structuredClone(flow));
  }
  async byId(flowId: string) {
    const value = this.records.get(flowId);
    return value && structuredClone(value);
  }
  async byStateHash(stateHash: string) {
    const value = [...this.records.values()].find((flow) => flow.stateHash === stateHash);
    return value && structuredClone(value);
  }
  async update(flow: AuthFlow) {
    this.records.set(flow.flowId, structuredClone(flow));
  }
  async consume(flowId: string) {
    const value = this.records.get(flowId);
    if (!value || value.status !== 'complete' || !value.completionToken) return undefined;
    const consumed = structuredClone(value);
    value.status = 'consumed';
    value.completionToken = undefined;
    this.records.set(flowId, value);
    return consumed;
  }
}

export class MemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionRecord>();
  async save(session: SessionRecord) {
    this.records.set(session.tokenHash, { ...session });
  }
  async byTokenHash(tokenHash: string) {
    const value = this.records.get(tokenHash);
    return value && { ...value };
  }
  async revoke(tokenHash: string) {
    const value = this.records.get(tokenHash);
    if (value) {
      value.revokedAt = Date.now();
      this.records.set(tokenHash, value);
    }
  }
  async revokeForUser(googleSub: string) {
    for (const value of this.records.values())
      if (value.googleSub === googleSub) value.revokedAt = Date.now();
  }
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly records = new Map<string, CredentialRecord>();
  async get(googleSub: string) {
    const value = this.records.get(googleSub);
    return value && { ...value };
  }
  async save(record: CredentialRecord) {
    this.records.set(record.googleSub, { ...record });
  }
  async delete(googleSub: string) {
    this.records.delete(googleSub);
  }
}

export function secretHash(value: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${value}`).digest('hex');
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sameSecret(value: string, expectedHash: string, pepper: string): boolean {
  const actual = Buffer.from(secretHash(value, pepper), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
