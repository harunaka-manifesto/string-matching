import { FieldValue, Firestore } from '@google-cloud/firestore';
import type { BackendConfig } from '../config';
import type { SecretCipher } from '../security/cipher';
import type {
  AuthFlow,
  AuthFlowStore,
  CredentialRecord,
  CredentialStore,
  SessionRecord,
  SessionStore,
} from './repositories';

function data<T>(snapshot: { data?: () => Record<string, unknown> | undefined }): T | undefined {
  const value = snapshot.data?.();
  return value ? (value as T) : undefined;
}

function epoch(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  )
    return (value as { toMillis: () => number }).toMillis();
  return fallback;
}

export class FirestoreAuthFlowStore implements AuthFlowStore {
  constructor(
    private readonly db: Firestore,
    private readonly cipher: SecretCipher,
  ) {}
  private ref(id: string) {
    return this.db.collection('authFlows').doc(id);
  }
  async create(flow: AuthFlow) {
    await this.ref(flow.flowId).set(await this.toStored(flow));
  }
  async byId(flowId: string) {
    const snapshot = await this.ref(flowId).get();
    return snapshot.exists ? this.fromStored(data<AuthFlow>(snapshot)) : undefined;
  }
  async byStateHash(stateHash: string) {
    const snapshot = await this.db
      .collection('authFlows')
      .where('stateHash', '==', stateHash)
      .limit(1)
      .get();
    return snapshot.empty ? undefined : this.fromStored(data<AuthFlow>(snapshot.docs[0]!));
  }
  async update(flow: AuthFlow) {
    await this.ref(flow.flowId).set(await this.toStored(flow));
  }
  async consume(flowId: string) {
    const ref = this.ref(flowId);
    const stored = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const value = snapshot.exists
        ? data<AuthFlow & { completionTokenCiphertext?: string }>(snapshot)
        : undefined;
      if (
        !value ||
        value.status !== 'complete' ||
        (!value.completionToken && !value.completionTokenCiphertext)
      )
        return undefined;
      transaction.update(ref, {
        status: 'consumed',
        completionToken: FieldValue.delete(),
        completionTokenCiphertext: FieldValue.delete(),
      });
      return value;
    });
    return this.fromStored(stored);
  }
  private async toStored(flow: AuthFlow): Promise<Record<string, unknown>> {
    const stored = { ...flow } as Record<string, unknown>;
    delete stored.codeVerifierCiphertext;
    stored.codeVerifierCiphertext = await this.cipher.encrypt(flow.codeVerifier);
    delete stored.codeVerifier;
    delete stored.completionTokenCiphertext;
    if (flow.completionToken) {
      stored.completionTokenCiphertext = await this.cipher.encrypt(flow.completionToken);
      delete stored.completionToken;
    }
    stored.purgeAt = new Date(flow.purgeAt);
    return stored;
  }
  private async fromStored(value: AuthFlow | undefined): Promise<AuthFlow | undefined> {
    if (!value) return undefined;
    const item = value as AuthFlow & { codeVerifierCiphertext?: string };
    const codeVerifier =
      item.codeVerifier ??
      (item.codeVerifierCiphertext ? await this.cipher.decrypt(item.codeVerifierCiphertext) : '');
    const completionToken =
      item.completionToken ??
      (item.completionTokenCiphertext
        ? await this.cipher.decrypt(item.completionTokenCiphertext)
        : undefined);
    return {
      ...item,
      codeVerifier,
      completionToken,
      purgeAt: epoch(item.purgeAt, item.expiresAt),
    };
  }
}

export class FirestoreSessionStore implements SessionStore {
  constructor(private readonly db: Firestore) {}
  private ref(hash: string) {
    return this.db.collection('sessions').doc(hash);
  }
  async save(session: SessionRecord) {
    await this.ref(session.tokenHash).set({ ...session, purgeAt: new Date(session.purgeAt) });
  }
  async byTokenHash(tokenHash: string) {
    const snapshot = await this.ref(tokenHash).get();
    if (!snapshot.exists) return undefined;
    const value = data<SessionRecord>(snapshot)!;
    return { ...value, purgeAt: epoch(value.purgeAt, value.absoluteExpiresAt) };
  }
  async revoke(tokenHash: string) {
    await this.ref(tokenHash).set({ revokedAt: Date.now() }, { merge: true });
  }
  async revokeForUser(googleSub: string) {
    const snapshot = await this.db.collection('sessions').where('googleSub', '==', googleSub).get();
    const batch = this.db.batch();
    for (const doc of snapshot.docs) batch.set(doc.ref, { revokedAt: Date.now() }, { merge: true });
    await batch.commit();
  }
}

export class FirestoreCredentialStore implements CredentialStore {
  constructor(
    private readonly db: Firestore,
    private readonly cipher: SecretCipher,
  ) {}
  private ref(sub: string) {
    return this.db.collection('googleCredentials').doc(sub);
  }
  async get(googleSub: string) {
    const snapshot = await this.ref(googleSub).get();
    if (!snapshot.exists) return undefined;
    const value = data<CredentialRecord>(snapshot)!;
    return {
      ...value,
      refreshTokenCiphertext: await this.cipher.decrypt(value.refreshTokenCiphertext),
    };
  }
  async save(record: CredentialRecord) {
    await this.ref(record.googleSub).set({
      ...record,
      refreshTokenCiphertext: await this.cipher.encrypt(record.refreshTokenCiphertext),
    });
  }
  async delete(googleSub: string) {
    await this.ref(googleSub).delete();
  }
}

export function productionStores(config: BackendConfig, cipher: SecretCipher) {
  const db = new Firestore({
    projectId: config.googleCloudProject,
    databaseId: config.firestoreDatabase,
  });
  return {
    flows: new FirestoreAuthFlowStore(db, cipher),
    sessions: new FirestoreSessionStore(db),
    credentials: new FirestoreCredentialStore(db, cipher),
  };
}
