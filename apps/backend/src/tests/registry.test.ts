import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { registryHandler } from '../handler';
import { sha256, createCopyId } from '@string-binder/domain';
let db: PGlite;
const ctx = { feature: 'checkout', screen: 'confirmation', context: '', role: 'title', note: '' };
let serial = 0;
function copyId() {
  return createCopyId(1791244800000 + serial++, new Uint8Array(10).fill(42));
}
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const values = Object.values(args).map((v) => (typeof v === 'object' ? JSON.stringify(v) : v));
  const columns = Object.keys(args)
    .map((key, i) => `${key} => $${i + 1}`)
    .join(',');
  const result = await db.query<{ value: unknown }>(
    `select public.${name}(${columns}) as value`,
    values,
  );
  return result.rows[0]?.value as any;
};
const api = registryHandler({
  rpc: call,
  tokens: [
    { hash: sha256('writer-test'), role: 'writer' },
    { hash: sha256('publisher-test'), role: 'publisher' },
  ],
});
async function request(path: string, body?: unknown, token = 'writer-test') {
  const r = await api(
    new Request('https://example.test/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-copy-token': token, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  return { status: r.status, body: await r.json() };
}
function create(id = copyId()) {
  return {
    action: 'create',
    copyId: id,
    product: 'investment',
    context: ctx,
    en: 'Invest now',
    id: 'Investasi sekarang',
  };
}
function batch(ops: any[], requestId = crypto.randomUUID()) {
  return { requestId, operations: ops };
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(await readFile('supabase/migrations/202610060001_registry.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/202610060002_operations.sql', 'utf8'));
  await call('copy_registry_bootstrap', {
    history: [{ copyId: 'legacy', event: 'ID_ASSIGNED' }],
    records: [],
    products: [
      { id: 'investment', displayName: 'Investment', keyToken: 'investment', legacyGroups: [] },
    ],
  });
}, 30000);
afterAll(async () => db.close());
describe('registry transactions and access', () => {
  it('rejects missing/revoked tokens and publisher impersonation', async () => {
    expect((await request('catalog', undefined, '')).status).toBe(401);
    expect((await request('catalog', undefined, 'revoked')).status).toBe(401);
    expect(
      (await request('library', { operation: 'start', args: {}, role: 'publisher' })).status,
    ).toBe(403);
  });
  it('denies direct anonymous table and RPC access', async () => {
    await db.exec('set role anon');
    try {
      await expect(db.query('select * from copy_private.copies')).rejects.toThrow();
      await expect(db.query('select public.copy_registry_catalog()')).rejects.toThrow();
    } finally {
      await db.exec('reset role');
    }
  });
  it('allocates distinct identities and unique keys for ten concurrent identical submissions', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => request('submit', batch([create()]))),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(new Set(results.map((r) => r.body.records[0].copyId)).size).toBe(10);
    expect(new Set(results.map((r) => r.body.records[0].platformKey)).size).toBe(10);
    expect(results[9].body.records[0].platformKey).toMatch(/_10$/);
  });
  it('recovers a lost response with the same request and rejects altered payload', async () => {
    const payload = batch([create()]);
    const first = await request('submit', payload);
    const second = await request('submit', payload);
    expect(second.body).toEqual(first.body);
    expect((await request('request?id=' + payload.requestId)).body).toEqual(first.body);
    expect(
      (
        await request('submit', {
          ...payload,
          operations: [{ ...payload.operations[0], en: 'Different' }],
        })
      ).body.error,
    ).toBe('REQUEST_REUSED');
    expect((await request('submit', batch([payload.operations[0]]))).body.error).toBe(
      'DUPLICATE_COPY_ID',
    );
  });
  it('rejects a competing edit atomically including creations and keeps the immutable revision', async () => {
    const r = (await request('submit', batch([create()]))).body.records[0];
    const edit = {
      action: 'edit',
      copyId: r.copyId,
      expectedRevision: 1,
      context: ctx,
      en: 'Updated',
      id: 'Diperbarui',
    };
    expect((await request('submit', batch([edit]))).status).toBe(200);
    const orphan = create();
    const conflict = await request('submit', batch([orphan, edit]));
    expect(conflict.body.error).toBe('REVISION_CONFLICT');
    expect(
      (await request('catalog')).body.records.some((x: any) => x.copyId === orphan.copyId),
    ).toBe(false);
    expect((await request('revision?id=' + r.copyId + '&revision=1')).body.en).toBe('Invest now');
    expect(
      (await request('submit', batch([{ action: 'reuse', copyId: r.copyId, expectedRevision: 1 }])))
        .status,
    ).toBe(409);
  });
  it('validates translations and placeholder consistency without trimming', async () => {
    expect((await request('submit', batch([{ ...create(), id: '' }]))).status).toBe(422);
    expect(
      (await request('submit', batch([{ ...create(), en: 'Pay {amount}', id: 'Bayar {price}' }])))
        .status,
    ).toBe(422);
    const r = await request(
      'submit',
      batch([{ ...create(), en: '  Hello\n世界 🚀 ', id: '  Halo\n世界 🚀 ' }]),
    );
    expect(r.body.records[0].en).toBe('  Hello\n世界 🚀 ');
  });
  it('coordinates fixed manifests, refuses a second publisher lease and preserves later edits', async () => {
    const r = (await request('submit', batch([create()]))).body.records[0];
    const { recordFingerprint } = await import('@string-binder/domain');
    const manifest = [{ copyId: r.copyId, revision: 1, fingerprint: recordFingerprint(r) }];
    const args = {
      libraryId: 'main',
      fileKey: 'file-key',
      runId: 'run-one',
      owner: 'device-one',
      manifest,
    };
    expect((await request('library', { operation: 'start', args }, 'publisher-test')).status).toBe(
      200,
    );
    expect(
      (
        await request(
          'library',
          { operation: 'start', args: { ...args, runId: 'run-two', owner: 'device-two' } },
          'publisher-test',
        )
      ).body.error,
    ).toBe('LEASE');
    const mappings = [
      {
        libraryId: 'main',
        copyId: r.copyId,
        variableId: 'v1',
        variableKey: 'key1',
        syncedRevision: 1,
        publishedRevision: null,
        fingerprint: manifest[0].fingerprint,
      },
    ];
    expect(
      (
        await request(
          'library',
          { operation: 'ack', args: { runId: 'run-one', owner: 'device-one', mappings } },
          'publisher-test',
        )
      ).status,
    ).toBe(200);
    await request(
      'submit',
      batch([
        {
          action: 'edit',
          copyId: r.copyId,
          expectedRevision: 1,
          context: ctx,
          en: 'Newer',
          id: 'Lebih baru',
        },
      ]),
    );
    expect(
      (
        await request(
          'library',
          { operation: 'publish', args: { runId: 'run-one', owner: 'device-one' } },
          'publisher-test',
        )
      ).status,
    ).toBe(200);
    const catalog = (await request('catalog')).body;
    expect(catalog.records.find((x: any) => x.copyId === r.copyId).revision).toBe(2);
    expect(catalog.mappings[0].publishedRevision).toBe(1);
  });
  it('returns complete bounded delta pages and enforces rate counters', async () => {
    const many = batch(Array.from({ length: 510 }, () => create()));
    expect((await request('submit', many)).status).toBe(200);
    const page = (await request('changes?after=0')).body;
    expect(page.events).toHaveLength(500);
    expect(page.more).toBe(true);
    const second = (await request('changes?after=' + page.seq)).body;
    expect(second.seq).toBeGreaterThan(page.seq);
    expect(second.events.length).toBeGreaterThan(0);
    expect(await call('copy_registry_rate', { credential: 'rate-test', allowed: 2 })).toBe(true);
    expect(await call('copy_registry_rate', { credential: 'rate-test', allowed: 2 })).toBe(true);
    expect(await call('copy_registry_rate', { credential: 'rate-test', allowed: 2 })).toBe(false);
  });
  it('rejects changing a fixed manifest and duplicate mapping acknowledgements', async () => {
    const catalog = (await request('catalog')).body;
    const r = catalog.records[0];
    const { recordFingerprint } = await import('@string-binder/domain');
    const entry = { copyId: r.copyId, revision: r.revision, fingerprint: recordFingerprint(r) };
    const args = {
      libraryId: 'manifest-test',
      fileKey: 'manifest-key',
      runId: 'fixed',
      owner: 'owner',
      manifest: [entry],
    };
    expect((await request('library', { operation: 'start', args }, 'publisher-test')).status).toBe(
      200,
    );
    expect(
      (
        await request(
          'library',
          { operation: 'start', args: { ...args, manifest: [{ ...entry, revision: 999 }] } },
          'publisher-test',
        )
      ).status,
    ).toBe(422);
    const mapping = {
      libraryId: 'manifest-test',
      copyId: r.copyId,
      variableKey: 'key',
      variableId: 'var',
      syncedRevision: r.revision,
      publishedRevision: null,
      fingerprint: entry.fingerprint,
    };
    expect(
      (
        await request(
          'library',
          {
            operation: 'ack',
            args: { runId: 'fixed', owner: 'owner', mappings: [mapping, mapping] },
          },
          'publisher-test',
        )
      ).status,
    ).toBe(422);
  });
  it('returns all 20,000 records and complete bounded deltas', async () => {
    const seed = Array.from({ length: 20000 }, (_, i) => ({
      copyId: copyId(),
      platformKey: 'seed_' + i,
      revision: 1,
      product: 'investment',
      context: ctx,
      en: 'Seed ' + i,
      id: 'Contoh ' + i,
      status: 'active',
      aliases: [],
    }));
    await db.query(
      "insert into copy_private.copies select r->>'copyId',r from jsonb_array_elements($1::jsonb) r",
      [JSON.stringify(seed)],
    );
    const before = await request('catalog');
    expect(before.body.records.length).toBeGreaterThanOrEqual(20000);
    let cursor = 0;
    const seen: number[] = [];
    for (;;) {
      const page = (await request('changes?after=' + cursor)).body;
      expect(page.seq).toBeGreaterThanOrEqual(cursor);
      cursor = page.seq;
      seen.push(...page.events.map((_: unknown, i: number) => i));
      if (!page.more) break;
    }
    expect(cursor).toBe(before.body.seq);
  }, 30000);
  it('backs up and restores revisions, reservations, requests and migration history', async () => {
    const snapshot = await call('copy_registry_backup');
    expect(snapshot.tables.migration_history).toHaveLength(1);
    const restored = new PGlite();
    try {
      await restored.exec('create role anon;create role authenticated;create role service_role;');
      await restored.exec(await readFile('supabase/migrations/202610060001_registry.sql', 'utf8'));
      await restored.exec(
        await readFile('supabase/migrations/202610060002_operations.sql', 'utf8'),
      );
      await restored.query('select public.copy_registry_restore($1::jsonb)', [
        JSON.stringify(snapshot),
      ]);
      const catalog = await restored.query<{ value: any }>(
        'select public.copy_registry_catalog() as value',
      );
      expect(catalog.rows[0].value.records).toHaveLength(snapshot.tables.copies.length);
      expect(catalog.rows[0].value.seq).toBe(snapshot.tables.registry_head[0].seq);
      const counts = await restored.query<{ n: number }>(
        'select count(*)::integer n from copy_private.key_reservations',
      );
      expect(counts.rows[0].n).toBe(snapshot.tables.key_reservations.length);
      const saved = snapshot.tables.requests[0];
      const result = await restored.query<{ value: any }>(
        'select public.copy_registry_request($1) as value',
        [saved.request_id],
      );
      expect(result.rows[0].value).toEqual(saved.result);
      await expect(
        restored.query('select public.copy_registry_restore($1::jsonb)', [
          JSON.stringify(snapshot),
        ]),
      ).rejects.toThrow('fresh empty');
    } finally {
      await restored.close();
    }
  }, 30000);

  it('renews a paused publisher lease and prevents takeover while another publisher owns it', async () => {
    const r = (await request('submit', batch([create()]))).body.records[0];
    const { recordFingerprint } = await import('@string-binder/domain');
    const args = {
      libraryId: 'renew-test',
      fileKey: 'renew-file',
      runId: 'renew-one',
      owner: 'publisher-one',
      manifest: [{ copyId: r.copyId, revision: 1, fingerprint: recordFingerprint(r) }],
    };
    await request('library', { operation: 'start', args }, 'publisher-test');
    await db.query(
      "update copy_private.libraries set lease_until=now()-interval '1 minute' where id='renew-test'",
    );
    expect(
      (
        await request(
          'library',
          { operation: 'renew', args: { runId: args.runId, owner: args.owner } },
          'publisher-test',
        )
      ).status,
    ).toBe(200);
    await db.query(
      "update copy_private.libraries set lease_until=now()-interval '1 minute' where id='renew-test'",
    );
    expect(
      (
        await request(
          'library',
          { operation: 'start', args: { ...args, runId: 'renew-two', owner: 'publisher-two' } },
          'publisher-test',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          'library',
          { operation: 'renew', args: { runId: args.runId, owner: args.owner } },
          'publisher-test',
        )
      ).body.error,
    ).toBe('LEASE');
  });
  it('returns structured errors for malformed payloads and logs metadata without credentials', async () => {
    const logs: any[] = [];
    const handler = registryHandler({
      rpc: call,
      tokens: [{ hash: sha256('writer-test'), role: 'writer' }],
      onResult: (e) => logs.push(e),
    });
    const malformed = await handler(
      new Request('https://example.test/submit', {
        method: 'POST',
        headers: { 'x-copy-token': 'writer-test' },
        body: '{',
      }),
    );
    expect(malformed.status).toBe(422);
    const huge = await handler(
      new Request('https://example.test/submit', {
        method: 'POST',
        headers: { 'x-copy-token': 'writer-test' },
        body: ' '.repeat(4 * 1024 * 1024 + 1),
      }),
    );
    expect(huge.status).toBe(413);
    expect(logs.map((e) => e.error)).toEqual(['VALIDATION', 'VALIDATION']);
    expect(JSON.stringify(logs)).not.toContain('writer-test');
  });
});
it('handles preflight without database access and protects all subsequent data requests', async () => {
  let calls = 0;
  const handler = registryHandler({
    rpc: async () => {
      calls++;
    },
    tokens: [],
  });
  const preflight = await handler(
    new Request('https://example.test/submit', {
      method: 'OPTIONS',
      headers: { Origin: 'null', 'Access-Control-Request-Headers': 'x-copy-token, content-type' },
    }),
  );
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('x-copy-token');
  expect(calls).toBe(0);
  const data = await handler(new Request('https://example.test/catalog'));
  expect(data.status).toBe(401);
  expect(data.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(calls).toBe(0);
  expect((await request('changes?after=-1')).status).toBe(422);
  expect((await request('submit')).status).toBe(405);
});
