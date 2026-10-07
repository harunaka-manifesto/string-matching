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
  await db.exec(await readFile('supabase/migrations/202610080001_library_fixes.sql', 'utf8'));
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
  it('registers a library only once a start succeeds, and lets an administrator correct it', async () => {
    const r = (await request('submit', batch([create()]))).body.records[0];
    const { recordFingerprint } = await import('@string-binder/domain');
    const entry = { copyId: r.copyId, revision: 1, fingerprint: recordFingerprint(r) };
    const start = (args: Record<string, unknown>) =>
      request(
        'library',
        {
          operation: 'start',
          args: {
            libraryId: 'reg',
            fileKey: 'wrong',
            runId: crypto.randomUUID(),
            owner: 'o',
            manifest: [entry],
            ...args,
          },
        },
        'publisher-test',
      );
    // A rejected first attempt (unknown revision) must not register the wrong file.
    expect((await start({ manifest: [{ ...entry, revision: 99 }] })).status).toBe(422);
    expect((await start({ fileKey: 'right' })).status).toBe(200);
    expect((await start({ fileKey: 'wrong' })).body.error).toBe('DESTINATION');
    // Another library ID cannot claim an already registered file: a clear 409, not an outage.
    const other = await start({ libraryId: 'reg-2', fileKey: 'right' });
    expect(other.status).toBe(409);
    expect(other.body.error).toBe('DESTINATION');
    expect(
      await call('copy_registry_library_reset', { library_id: 'reg', file_key: 'moved' }),
    ).toMatchObject({
      previousFileKey: 'right',
    });
    expect((await start({ fileKey: 'moved' })).status).toBe(200);
  });
  it('publishes a run whose identity a newer sync took over, and repeating publish is a no-op', async () => {
    const r = (await request('submit', batch([create()]))).body.records[0];
    const { recordFingerprint } = await import('@string-binder/domain');
    const entry = { copyId: r.copyId, revision: 1, fingerprint: recordFingerprint(r) };
    const lib = { libraryId: 'super', fileKey: 'super-key', owner: 'o' };
    const library = (operation: string, args: Record<string, unknown>) =>
      request('library', { operation, args: { ...args } }, 'publisher-test');
    const mapping = (revision: number, fingerprint: string) => ({
      libraryId: 'super',
      copyId: r.copyId,
      variableId: 'v',
      variableKey: 'k',
      syncedRevision: revision,
      publishedRevision: null,
      fingerprint,
    });
    expect((await library('start', { ...lib, runId: 'old', manifest: [entry] })).status).toBe(200);
    expect(
      (
        await library('ack', {
          runId: 'old',
          owner: 'o',
          mappings: [mapping(1, entry.fingerprint)],
        })
      ).status,
    ).toBe(200);
    const edited = (
      await request(
        'submit',
        batch([
          {
            action: 'edit',
            copyId: r.copyId,
            expectedRevision: 1,
            context: ctx,
            en: 'Two',
            id: 'Dua',
          },
        ]),
      )
    ).body.records[0];
    const newer = { copyId: r.copyId, revision: 2, fingerprint: recordFingerprint(edited) };
    expect((await library('start', { ...lib, runId: 'new', manifest: [newer] })).status).toBe(200);
    expect(
      (
        await library('ack', {
          runId: 'new',
          owner: 'o',
          mappings: [mapping(2, newer.fingerprint)],
        })
      ).status,
    ).toBe(200);
    // The old run's only entry now belongs to the newer sync: nothing to publish, no conflict.
    expect((await library('publish', { runId: 'old', owner: 'o' })).status).toBe(200);
    expect((await library('publish', { runId: 'new', owner: 'o' })).status).toBe(200);
    const events = (await request('changes?after=0')).body.seq;
    expect((await library('publish', { runId: 'new', owner: 'o' })).status).toBe(200);
    expect((await request('changes?after=0')).body.seq).toBe(events);
    const catalog = (await request('catalog')).body;
    expect(catalog.mappings.find((m: any) => m.copyId === r.copyId)).toMatchObject({
      syncedRevision: 2,
      publishedRevision: 2,
    });
  });
  it('keys variants of legacy roles with a supported role and qualifier', async () => {
    const legacy = { ...ctx, role: 'cta-primary' };
    const first = await request('submit', batch([{ ...create(), context: legacy }]));
    const second = await request('submit', batch([{ ...create(), context: legacy }]));
    expect(first.status).toBe(200);
    expect(first.body.records[0].platformKey).toBe(
      'gopay_investment_checkout_confirmation_cta_primary',
    );
    expect(second.body.records[0].platformKey).toBe(
      'gopay_investment_checkout_confirmation_cta_primary_2',
    );
    const push = await request(
      'submit',
      batch([{ ...create(), context: { ...ctx, role: 'push-title' } }]),
    );
    expect(push.body.records[0].platformKey).toMatch(/_pushtitle$/);
  });
  it('rate-limits per device so one shared team token does not throttle everyone', async () => {
    const hit = (device: string) =>
      api(
        new Request('https://example.test/catalog', {
          headers: { 'x-copy-token': 'writer-test', 'x-copy-device': device },
        }),
      );
    const key = (device: string) => sha256(`${sha256('writer-test')}:${device}`);
    for (let i = 0; i < 180; i += 1)
      await call('copy_registry_rate', { credential: key('busy'), allowed: 1000 });
    expect((await hit('busy')).status).toBe(429);
    expect((await hit('quiet')).status).toBe(200);
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

  it('backs up and restores in pages that each fit one request, and reruns a stopped restore', async () => {
    const { pagedBackup, pagedRestore } = await import(
      // @ts-expect-error Plain administrator script without type declarations.
      '../../../../scripts/registry-snapshot.mjs'
    );
    await db.exec(await readFile('supabase/migrations/202610080003_backup_pages.sql', 'utf8'));
    const sizes: number[] = [];
    const snapshot = await pagedBackup(
      async (name: string, args: Record<string, unknown>) => {
        const value = await call(name, args);
        sizes.push(JSON.stringify(value).length);
        return value;
      },
      { pageSize: 2000 },
    );
    // Same rows as the one-shot backup; pages come in primary-key order.
    const whole = await call('copy_registry_backup');
    const sorted = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).sort();
    for (const table of Object.keys(whole.tables))
      expect(sorted(snapshot.tables[table])).toEqual(sorted(whole.tables[table]));
    expect(Math.max(...sizes)).toBeLessThan(JSON.stringify(whole).length);
    const target = new PGlite();
    try {
      await target.exec('create role anon;create role authenticated;create role service_role;');
      for (const file of [
        '202610060001_registry.sql',
        '202610060002_operations.sql',
        '202610080003_backup_pages.sql',
      ])
        await target.exec(await readFile('supabase/migrations/' + file, 'utf8'));
      let pages = 0;
      let stopAfter = 3;
      const rpc = async (name: string, args: Record<string, unknown> = {}) => {
        if (name === 'copy_registry_restore_page' && ++pages > stopAfter)
          throw new Error('Connection lost');
        const keys = Object.keys(args);
        const result = await target.query<{ value: any }>(
          `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}) as value`,
          keys.map((k) => (typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])),
        );
        return result.rows[0]!.value;
      };
      await expect(pagedRestore(rpc, snapshot, { maxBytes: 1_000_000 })).rejects.toThrow(
        'Connection lost',
      );
      stopAfter = Infinity;
      expect(await pagedRestore(rpc, snapshot, { maxBytes: 1_000_000 })).toMatchObject({
        restored: true,
        seq: snapshot.tables.registry_head[0].seq,
      });
      const catalog = await target.query<{ value: any }>(
        'select public.copy_registry_catalog() as value',
      );
      expect(catalog.rows[0].value.records).toHaveLength(snapshot.tables.copies.length);
      await expect(rpc('copy_registry_restore_begin')).rejects.toThrow('fresh empty');
    } finally {
      await target.close();
    }
  }, 60000);

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
it('bootstraps resolved key ownership: one owner per key, ambiguous keys reserved without an alias', async () => {
  const { applyResolutions, keyClaims } = await import(
    // @ts-expect-error Plain administrator script without type declarations.
    '../../../../scripts/registry-records.mjs'
  );
  const record = (copyId: string, platformKey: string, aliases: string[]) => ({
    copyId,
    platformKey,
    revision: 1,
    en: 'Text',
    id: 'Teks',
    product: 'investment',
    context: ctx,
    status: 'active',
    aliases,
    mergedInto: null,
  });
  const [holder, claimant, first, second] = [copyId(), copyId(), copyId(), copyId()];
  const records = [
    record(holder, 'gopay_investment_fee_title', []),
    record(claimant, 'gopay_investment_amount_title', ['gopay_investment_fee_title']),
    record(first, 'gopay_investment_push_pushtitle', ['gopay_investment_push_text']),
    record(second, 'gopay_investment_push_pushbody', ['gopay_investment_push_text']),
  ];
  const byId = new Map(records.map((r) => [r.copyId, r]));
  const products = [
    { id: 'investment', displayName: 'Investment', keyToken: 'investment', legacyGroups: [] },
  ];
  const fresh = async () => {
    const other = new PGlite();
    await other.exec('create role anon; create role authenticated; create role service_role;');
    await other.exec(await readFile('supabase/migrations/202610060001_registry.sql', 'utf8'));
    return other;
  };
  const bootstrap = (target: PGlite, reservations: unknown[]) =>
    target.query(
      'select public.copy_registry_bootstrap(records=>$1,products=>$2,reservations=>$3)',
      [JSON.stringify(records), JSON.stringify(products), JSON.stringify(reservations)],
    );
  const unresolved = await fresh();
  await expect(bootstrap(unresolved, [])).rejects.toThrow('Unresolved key ownership');
  await unresolved.close();

  applyResolutions(records, byId, [
    { key: 'gopay_investment_fee_title', owner: holder, released: [claimant] },
    { key: 'gopay_investment_push_text', owner: null, released: [first, second] },
  ]);
  expect(
    [...keyClaims(records, (id: string) => id).values()].every((c: any) => c.owners.size === 1),
  ).toBe(true);
  expect(() =>
    applyResolutions(records, byId, [
      { key: 'gopay_investment_fee_title', owner: holder, released: [claimant] },
    ]),
  ).toThrow('no longer matches');

  const resolved = await fresh();
  await bootstrap(resolved, [{ key: 'gopay_investment_push_text', copyId: first }]);
  const owners = await resolved.query<{ key: string; copy_id: string }>(
    'select key,copy_id from copy_private.key_reservations order by key',
  );
  expect(Object.fromEntries(owners.rows.map((r) => [r.key, r.copy_id]))).toMatchObject({
    gopay_investment_fee_title: holder,
    gopay_investment_push_text: first,
  });
  const saved = await resolved.query<{ aliases: string[] }>(
    "select record->'aliases' as aliases from copy_private.copies",
  );
  expect(saved.rows.flatMap((r) => r.aliases)).toEqual([]);
  await resolved.close();
}, 30000);
it('imports in small staged chunks, resumes a crashed import, and never wipes a live registry', async () => {
  const { stagedBootstrap } = await import(
    // @ts-expect-error Plain administrator script without type declarations.
    '../../../../scripts/registry-records.mjs'
  );
  const other = new PGlite();
  await other.exec('create role anon; create role authenticated; create role service_role;');
  for (const file of [
    '202610060001_registry.sql',
    '202610070001_bootstrap_staging.sql',
    '202610070002_bootstrap_apply.sql',
    '202610080002_bootstrap_recovery.sql',
  ])
    await other.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  const sizes: number[] = [];
  let applies = 0;
  let crashAfter = 3;
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    if (name === 'copy_registry_bootstrap_apply' && ++applies > crashAfter)
      throw new Error('Connection lost');
    sizes.push(JSON.stringify(args).length);
    const keys = Object.keys(args);
    const result = await other.query<{ value: any }>(
      `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}) as value`,
      keys.map((k) => (typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])),
    );
    return result.rows[0]!.value;
  };
  const records = Array.from({ length: 40 }, (_, i) => ({
    copyId: copyId(),
    platformKey: `gopay_investment_staged${i}_title`,
    revision: 1,
    en: 'Text '.repeat(40),
    id: 'Teks',
    product: 'investment',
    context: ctx,
    status: 'active',
    aliases: [],
    mergedInto: null,
  }));
  const payload = {
    records,
    products: [
      { id: 'investment', displayName: 'Investment', keyToken: 'investment', legacyGroups: [] },
    ],
    history: records.map((r, i) => ({ event: 'ID_ASSIGNED', copyId: r.copyId, order: i })),
    reservations: [{ key: 'gopay_investment_ambiguous_text', copyId: records[0]!.copyId }],
  };
  const options = { maxBytes: 2000, reservedKeys: 41 };
  await expect(stagedBootstrap(rpc, payload, options)).rejects.toThrow('Connection lost');
  const partial = await rpc('copy_registry_bootstrap_status');
  expect(partial.copies).toBeGreaterThan(0);
  expect(partial.copies).toBeLessThan(40);
  expect(partial.stagedChunks).toBeGreaterThan(0);

  // The rerun removes the partial import and completes.
  crashAfter = Infinity;
  expect(await stagedBootstrap(rpc, payload, options)).toEqual({
    imported: 40,
    reservedKeys: 41,
    history: 40,
  });
  expect(Math.max(...sizes)).toBeLessThan(4000);
  const counts = await other.query<any>(
    `select (select count(*) from copy_private.copies)::int as copies,
            (select seq from copy_private.registry_head)::int as seq,
            (select count(*) from copy_private.bootstrap_stage)::int as staged,
            (select array_agg((event->>'order')::int order by event_index) from copy_private.migration_history) as history`,
  );
  expect(counts.rows[0]).toMatchObject({ copies: 40, seq: 40, staged: 0 });
  expect(counts.rows[0].history).toEqual(records.map((_, i) => i));
  // Applying a chunk twice does nothing; a finished registry cannot be staged into or wiped.
  expect(
    await rpc('copy_registry_bootstrap_apply', { stage_kind: 'records', stage_chunk: 0 }),
  ).toEqual({ applied: 0 });
  expect(await stagedBootstrap(rpc, payload, options)).toMatchObject({ alreadyImported: true });
  await expect(rpc('copy_registry_bootstrap_abort')).rejects.toThrow('No import is in progress');

  // A run that stopped after products, before any record, is recoverable too.
  const fresh = new PGlite();
  await fresh.exec('create role anon; create role authenticated; create role service_role;');
  for (const file of [
    '202610060001_registry.sql',
    '202610070001_bootstrap_staging.sql',
    '202610070002_bootstrap_apply.sql',
    '202610080002_bootstrap_recovery.sql',
  ])
    await fresh.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  let freshApplies = 0;
  let stopAfter = 1;
  const freshRpc = async (name: string, args: Record<string, unknown> = {}) => {
    if (name === 'copy_registry_bootstrap_apply' && ++freshApplies > stopAfter)
      throw new Error('Connection lost');
    const keys = Object.keys(args);
    const result = await fresh.query<{ value: any }>(
      `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}) as value`,
      keys.map((k) => (typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])),
    );
    return result.rows[0]!.value;
  };
  await expect(stagedBootstrap(freshRpc, payload, options)).rejects.toThrow('Connection lost');
  expect(await freshRpc('copy_registry_bootstrap_status')).toMatchObject({
    copies: 0,
    products: 1,
  });
  // Even with the stage already cleared by an older script, abort still recovers.
  await freshRpc('copy_registry_bootstrap_reset');
  stopAfter = Infinity;
  expect(await stagedBootstrap(freshRpc, payload, options)).toMatchObject({ imported: 40 });
  await fresh.close();
  await expect(
    rpc('copy_registry_bootstrap_stage', { kind: 'records', chunk: 0, items: [] }),
  ).rejects.toThrow('empty registry');
  await expect(
    stagedBootstrap(rpc, { ...payload, records: records.slice(1) }, options),
  ).rejects.toThrow('different data');
  await other.close();
}, 60000);
it('reports outages as retryable so clients never discard a pending save', async () => {
  // Driver errors routinely contain words like "ID" or "ENOTFOUND"; none are validation.
  for (const failure of ['getaddrinfo ENOTFOUND db', 'Invalid ID in connection string']) {
    const handler = registryHandler({
      rpc: async (name) => {
        if (name === 'copy_registry_rate') return true;
        throw new Error(failure);
      },
      tokens: [{ hash: sha256('writer-test'), role: 'writer' }],
    });
    const response = await handler(
      new Request('https://example.test/submit', {
        method: 'POST',
        headers: { 'x-copy-token': 'writer-test' },
        body: JSON.stringify(batch([create()])),
      }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('UNAVAILABLE');
  }
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
