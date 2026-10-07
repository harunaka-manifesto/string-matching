import { readFile, writeFile } from 'node:fs/promises';
import { adminRpc } from './registry-admin.mjs';
import {
  REGISTRY_PATH,
  RESOLUTIONS_PATH,
  applyResolutions,
  keyClaims,
  loadRecords,
  stagedBootstrap,
} from './registry-records.mjs';
const args = process.argv.slice(2),
  apply = args.includes('--apply');
const path = args.find((a) => !a.startsWith('--')) ?? REGISTRY_PATH;
const { records, products, byId, canonicalId } = await loadRecords(path);
// Reviewed ownership decisions for keys several identities claimed historically.
const { resolutions } = JSON.parse(
  await readFile(RESOLUTIONS_PATH, 'utf8').catch(() => '{"resolutions":[]}'),
);
applyResolutions(records, byId, resolutions);
const reservations = resolutions
  .filter((r) => !r.owner)
  .map((r) => ({ key: r.key, copyId: r.reservedFor }));
for (const r of reservations)
  if (!byId.has(r.copyId)) throw new Error(`Unknown reservation owner for ${r.key}`);
const claims = keyClaims(records, canonicalId);
for (const r of reservations)
  if (claims.has(r.key)) throw new Error(`Ambiguous key ${r.key} is still claimed by an identity`);
const keys = new Set([...claims.keys(), ...reservations.map((r) => r.key)]);
const conflicts = [...claims]
  .filter(([, claim]) => claim.owners.size > 1)
  .map(([key, claim]) => ({
    key,
    owners: [...claim.owners].map((id) => byId.get(id)),
    claimants: claim.claimants.map((r) => ({
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
    `Bootstrap blocked by ${conflicts.length} historical key ownership conflicts. Review ${report}, then run pnpm registry:resolve-keys and review ${RESOLUTIONS_PATH}. Never mint IDs to hide them.`,
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
      keyResolutions: resolutions.length,
      keysReservedWithoutOwner: reservations.length,
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
  history.push(...resolutions.map((r) => ({ event: 'KEY_OWNERSHIP_RESOLVED', ...r })));
  console.log(
    await stagedBootstrap(
      adminRpc,
      { records, products, history, reservations },
      { reservedKeys: keys.size, log: (line) => console.error(line) },
    ),
  );
}
