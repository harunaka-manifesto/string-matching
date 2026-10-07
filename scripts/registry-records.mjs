import { access, readFile } from 'node:fs/promises';
import { models } from './registry-admin.mjs';

export const REGISTRY_PATH = 'figma-copy-migration/reimport/registry.jsonl';
export const LEDGER_PATH = 'figma-copy-migration/registry/migration-ledger.jsonl';
export const RESOLUTIONS_PATH = 'figma-copy-migration/registry/key-ownership-resolutions.json';

export const readJsonl = async (path) =>
  (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);

/** The reviewed replacement registry as contract records, plus redirect resolution. */
export async function loadRecords(path = REGISTRY_PATH) {
  await access(path).catch(() => {
    throw new Error(
      'Prepare the reviewed replacement registry first with pnpm prepare:library, or supply an explicit JSONL path',
    );
  });
  const rows = await readJsonl(path);
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
  for (const r of records) {
    if (!products.some((p) => p.id === r.product))
      throw new Error(`Unknown product ${r.product}; resolve configuration first`);
    if (r.mergedInto) r.mergedInto = canonicalId(r.copyId);
  }
  return { records, products, byId, canonicalId };
}

/** Every key with the canonical identities claiming it, as a current key or an alias. */
export function keyClaims(records, canonicalId) {
  const claims = new Map();
  for (const r of records)
    for (const key of [r.platformKey, ...r.aliases]) {
      const claim = claims.get(key) ?? { owners: new Set(), claimants: [] };
      claim.owners.add(canonicalId(r.copyId));
      claim.claimants.push(r);
      claims.set(key, claim);
    }
  return claims;
}

/**
 * Drop each resolved key from the alias list of the identities that lost it. The untouched
 * legacy row stays on the record, so no history is lost; only ownership becomes single.
 */
export function applyResolutions(records, byId, resolutions) {
  for (const resolution of resolutions)
    for (const id of resolution.released) {
      const r = byId.get(id);
      if (!r || !r.aliases.includes(resolution.key) || r.platformKey === resolution.key)
        throw new Error(
          `Key resolution for ${resolution.key} no longer matches the registry; rerun pnpm registry:resolve-keys and review the result`,
        );
      r.aliases = r.aliases.filter((key) => key !== resolution.key);
    }
  return records;
}

/**
 * Uploads small chunks into a staging table, then applies them one short transaction at a
 * time. Staged chunks remaining means an import is unfinished; a rerun wipes that partial
 * import and starts over, so the registry is never left half-imported.
 */
export async function stagedBootstrap(
  rpc,
  payload,
  { maxBytes = 1_000_000, reservedKeys, log = () => {} } = {},
) {
  const expected = {
    copies: payload.records.length,
    products: payload.products.length,
    history: payload.history.length,
    ...(reservedKeys === undefined ? {} : { reservations: reservedKeys }),
  };
  const complete = (status) =>
    !status.stagedChunks && Object.entries(expected).every(([k, n]) => status[k] === n);
  const before = await rpc('copy_registry_bootstrap_status');
  if (complete(before)) return { imported: before.copies, alreadyImported: true };
  if (before.copies && !before.stagedChunks)
    throw new Error(
      `Registry already holds ${before.copies} records that do not match the ${expected.copies} prepared. It was imported from different data; do not import over it.`,
    );
  // Any imported data short of a finished import (products or history applied before the
  // first record, say) is an unfinished import: wipe it, or re-applying products collides.
  const partial = ['copies', 'products', 'history', 'reservations'].some((k) => before[k]);
  if (partial) {
    log(
      `removing an unfinished import (${before.copies ?? 0} records, ${before.products ?? 0} products)`,
    );
    await retry(() => rpc('copy_registry_bootstrap_abort'));
  } else await retry(() => rpc('copy_registry_bootstrap_reset'));

  // Reservations for ownerless keys need their records, so records go first.
  const order = ['products', 'records', 'reservations', 'history'];
  const chunks = [];
  for (const kind of order) {
    let chunk = 0,
      batch = [],
      bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      await retry(() => rpc('copy_registry_bootstrap_stage', { kind, chunk, items: batch }));
      chunks.push({ kind, chunk, count: batch.length });
      log(`uploaded ${kind} ${chunk + 1} (${batch.length} items)`);
      chunk++;
      batch = [];
      bytes = 0;
    };
    for (const item of payload[kind]) {
      const size = Buffer.byteLength(JSON.stringify(item));
      if (bytes + size > maxBytes) await flush();
      batch.push(item);
      bytes += size;
    }
    await flush();
  }
  for (const [index, { kind, chunk }] of chunks.entries()) {
    await retry(() =>
      rpc('copy_registry_bootstrap_apply', { stage_kind: kind, stage_chunk: chunk }),
    );
    log(`applied ${index + 1}/${chunks.length} (${kind})`);
  }
  const after = await rpc('copy_registry_bootstrap_status');
  if (!complete(after))
    throw new Error(
      `Import finished with unexpected totals ${JSON.stringify(after)}; expected ${JSON.stringify(expected)}. Run the import again.`,
    );
  return { imported: after.copies, reservedKeys: after.reservations, history: after.history };
}

async function retry(operation, attempts = 4) {
  for (let attempt = 1; ; attempt++)
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
}
