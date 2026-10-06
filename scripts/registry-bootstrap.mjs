import { readFile, access, writeFile } from 'node:fs/promises';
import { adminRpc, models } from './registry-admin.mjs';
const args = process.argv.slice(2),
  apply = args.includes('--apply');
const path =
  args.find((a) => !a.startsWith('--')) ?? 'figma-copy-migration/reimport/registry.jsonl';
await access(path).catch(() => {
  throw new Error(
    'Prepare the reviewed replacement registry first with pnpm prepare:library, or supply an explicit JSONL path',
  );
});
const rows = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
const { CopyRecordSchema, ProductConfigSchema } = await models();
const products = JSON.parse(await readFile('supabase/products.json', 'utf8')).map((p) =>
  ProductConfigSchema.parse(p),
);
const productByLegacy = new Map(
  products.flatMap((p) => [p.id, ...p.legacyGroups].map((id) => [id, p.id])),
);
const records = rows.map((row) =>
  CopyRecordSchema.parse(
    row.localizedValues
      ? {
          copyId: row.copyId,
          platformKey: row.platformKey,
          revision: row.revision ?? 1,
          en: row.localizedValues.en ?? '',
          id: row.localizedValues.id ?? '',
          product: productByLegacy.get(row.domain) ?? row.domain,
          context: {
            feature: row.feature ?? '',
            screen: row.screen ?? '',
            context: row.context ?? '',
            role: row.role ?? 'text',
            note: row.metadata?.notes ?? '',
            ...(row.qualifier ? { qualifier: row.qualifier } : {}),
          },
          status: row.status === 'active' && row.metadata?.importHeld ? 'held' : row.status,
          legacy: row,
          aliases: [...new Set(row.legacyKeys ?? [])],
          mergedInto: row.metadata?.mergedInto ?? null,
          ...(row.forkedFrom ? { forkedFrom: row.forkedFrom } : {}),
        }
      : row,
  ),
);
const byId = new Map(records.map((r) => [r.copyId, r]));
if (byId.size !== records.length) throw new Error('Duplicate Copy IDs block bootstrap');
const canonicalId = (id) => {
  const seen = new Set();
  let r = byId.get(id);
  while (r?.mergedInto) {
    if (seen.has(r.copyId)) throw new Error('Migration redirect cycle');
    seen.add(r.copyId);
    r = byId.get(r.mergedInto);
    if (!r) throw new Error('Missing migration redirect target');
  }
  return r?.copyId ?? id;
};
const keys = new Map(),
  claims = new Map();
for (const r of records) {
  if (!products.some((p) => p.id === r.product))
    throw new Error(`Unknown product ${r.product}; resolve configuration first`);
  if (r.mergedInto) r.mergedInto = canonicalId(r.copyId);
  for (const key of [r.platformKey, ...r.aliases]) {
    const owner = canonicalId(r.copyId);
    const owners = claims.get(key) ?? new Set();
    owners.add(owner);
    claims.set(key, owners);
    keys.set(key, owner);
  }
}
const conflicts = [...claims]
  .filter(([, owners]) => owners.size > 1)
  .map(([key, owners]) => ({
    key,
    owners: [...owners].map((id) => byId.get(id)),
    claimants: records
      .filter((r) => r.platformKey === key || r.aliases.includes(key))
      .map((r) => ({
        copyId: r.copyId,
        status: r.status,
        mergedInto: r.mergedInto,
        platformKey: r.platformKey,
      })),
  }));
if (conflicts.length) {
  const report = 'figma-copy-migration/reports/registry-bootstrap-conflicts.json';
  await writeFile(report, JSON.stringify({ schemaVersion: 1, conflicts }, null, 2) + '\n');
  console.error(
    `Bootstrap blocked by ${conflicts.length} historical key ownership conflicts. Review ${report}; resolve against the existing ledger without minting IDs.`,
  );
  process.exitCode = 1;
}
console.log(
  JSON.stringify(
    {
      mode: apply ? 'apply' : 'dry-run',
      records: records.length,
      reservedKeys: keys.size,
      products: products.length,
      statusCounts: Object.fromEntries(
        [...new Set(records.map((r) => r.status))].map((s) => [
          s,
          records.filter((r) => r.status === s).length,
        ]),
      ),
    },
    null,
    2,
  ),
);
if (apply && !conflicts.length) {
  const history = (await readFile('figma-copy-migration/registry/migration-ledger.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const mergeEvents = await readFile(
    'figma-copy-migration/reimport/merge-events.jsonl',
    'utf8',
  ).catch(() => '');
  if (mergeEvents.trim()) history.push(...mergeEvents.trim().split('\n').map(JSON.parse));
  console.log(await adminRpc('copy_registry_bootstrap', { records, products, history }));
}
