import { AppError } from '@ux-copy-sync/contracts';
import { randomSecret, secretHash, type SessionRecord, type SessionStore } from './repositories';

export type AuthenticatedSession = { token: string; record: SessionRecord };

export class SessionService {
  constructor(
    private readonly store: SessionStore,
    private readonly pepper: string,
    private readonly idleDays: number,
    private readonly absoluteDays: number,
  ) {}

  async create(googleSub: string, email: string): Promise<AuthenticatedSession> {
    const token = randomSecret(32);
    const now = Date.now();
    const record: SessionRecord = {
      tokenHash: secretHash(token, this.pepper),
      googleSub,
      email,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: now + this.idleDays * 86_400_000,
      absoluteExpiresAt: now + this.absoluteDays * 86_400_000,
      purgeAt: now + this.absoluteDays * 86_400_000,
    };
    await this.store.save(record);
    return { token, record };
  }

  async authenticate(token: string): Promise<AuthenticatedSession> {
    const record = await this.store.byTokenHash(secretHash(token, this.pepper));
    if (
      !record ||
      record.revokedAt ||
      record.idleExpiresAt <= Date.now() ||
      record.absoluteExpiresAt <= Date.now()
    ) {
      throw new AppError('AUTH_REQUIRED', 'Connect your company Google account first.');
    }
    record.lastUsedAt = Date.now();
    record.idleExpiresAt = Math.min(
      Date.now() + this.idleDays * 86_400_000,
      record.absoluteExpiresAt,
    );
    await this.store.save(record);
    return { token, record };
  }

  async revoke(token: string): Promise<void> {
    await this.store.revoke(secretHash(token, this.pepper));
  }
  async revokeUser(googleSub: string): Promise<void> {
    await this.store.revokeForUser(googleSub);
  }
}
