// Run against a disposable staging registry only; created identities and keys are permanent.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
if (!process.argv.includes('--staging'))
  throw new Error('Use --staging only with a disposable staging Supabase project');
const url = process.env.COPY_REGISTRY_URL,
  token = process.env.COPY_TEAM_TOKEN;
if (!url || !token) throw new Error('Configure private staging URL/team token');
await build({
  entryPoints: ['packages/domain/src/copy-identity.ts'],
  outfile: 'apps/backend/dist/identity.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
});
const { createCopyId } = await import('../apps/backend/dist/identity.mjs');
const rpc = async (path, data) => {
  const r = await fetch(url + '/' + path, {
    method: data ? 'POST' : 'GET',
    headers: { 'x-copy-token': token, 'content-type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: r.status, body: await r.json() };
};
const catalog = (await rpc('catalog')).body;
assert.ok(
  catalog.records.length >= 20000,
  'Seed staging with at least 20,000 registry records before testing',
);
const product = catalog.products.find((p) => p.id !== 'shared');
const context = {
  feature: 'pilot',
  screen: randomUUID().replaceAll('-', '').slice(0, 12),
  context: 'concurrency',
  role: 'title',
  note: 'Disposable staging load test',
};
const batches = Array.from({ length: 10 }, () => ({
  requestId: randomUUID(),
  operations: [
    {
      action: 'create',
      copyId: createCopyId(Date.now(), randomBytes(10)),
      product: product.id,
      context,
      en: 'Concurrent test',
      id: 'Tes bersamaan',
    },
  ],
}));
const saved = await Promise.all(batches.map((b) => rpc('submit', b)));
assert.ok(saved.every((r) => r.status === 200));
assert.equal(new Set(saved.map((r) => r.body.records[0].platformKey)).size, 10);
assert.equal(new Set(saved.map((r) => r.body.records[0].copyId)).size, 10);
const copy = saved[0].body.records[0];
const edits = Array.from({ length: 10 }, (_, i) => ({
  requestId: randomUUID(),
  operations: [
    {
      action: 'edit',
      copyId: copy.copyId,
      expectedRevision: copy.revision,
      context,
      en: 'Version ' + i,
      id: 'Versi ' + i,
    },
  ],
}));
const competing = await Promise.all(edits.map((b) => rpc('submit', b)));
assert.equal(competing.filter((r) => r.status === 200).length, 1);
assert.equal(competing.filter((r) => r.status === 409).length, 9);
assert.deepEqual((await rpc('submit', batches[0])).body, saved[0].body);
let cursor = catalog.seq,
  events = [];
for (;;) {
  const p = (await rpc('changes?after=' + cursor)).body;
  assert.ok(p.seq >= cursor);
  cursor = p.seq;
  events.push(...p.events);
  if (!p.more) break;
}
assert.ok(batches.every((b) => events.some((e) => e.requestId === b.requestId)));
console.log(
  JSON.stringify(
    {
      passed: true,
      concurrentCreates: 10,
      uniqueKeys: 10,
      competingEdits: 10,
      conflicts: 9,
      catalogRecords: catalog.records.length,
    },
    null,
    2,
  ),
);
