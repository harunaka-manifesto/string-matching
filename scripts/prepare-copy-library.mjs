// Prepare a reviewed replacement library from the immutable migration registry.
// Raw locale values must all match: punctuation, case, whitespace, and translations are significant.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const root = resolve(new URL('..', import.meta.url).pathname);
const numeric =
  /^[-+]?\s*(?:rp|idr|usd|\$)?\s*[-+]?\s*\d[\d.,\s]*(?:%|x|×|rb|ribu|jt|juta|k|m|mb|gb|kb)?$/iu;
const eligible = (row) =>
  row.status === 'active' &&
  !row.metadata?.importHeld &&
  row.localizedValues.en &&
  row.localizedValues.id &&
  !Object.values(row.localizedValues).some(
    (value) => numeric.test(value.trim()) || /^\{[^{}]+\}$/u.test(value.trim()),
  );
const product = (row) =>
  row.domain === 'insurance-health-insurance-pre-ut' ? 'insurance' : row.domain;
const signature = (row) =>
  JSON.stringify(Object.entries(row.localizedValues).sort(([a], [b]) => a.localeCompare(b)));

export function prepareRegistry(source) {
  const rows = structuredClone(source);
  const reserved = new Set(rows.flatMap((row) => [row.platformKey, ...(row.legacyKeys ?? [])]));
  const groups = new Map();
  for (const row of rows) {
    if (!eligible(row)) continue;
    const key = signature(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const events = [];
  const merges = [];
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 2) continue;
    group.sort(
      (a, b) =>
        Number(b.domain === 'shared') - Number(a.domain === 'shared') ||
        a.copyId.localeCompare(b.copyId),
    );
    const canonical = group[0];
    const products = [...new Set(group.map(product))].sort();
    const shared = products.length > 1 || canonical.domain === 'shared';
    const usages = group.flatMap(
      (row) =>
        row.metadata.usages ?? [
          {
            product: product(row),
            name: row.name,
            section: row.metadata.section,
            feature: row.feature,
            screen: row.screen,
            context: row.context,
            role: row.role,
            notes: row.metadata.notes,
          },
        ],
    );
    canonical.metadata.usages = usages;
    canonical.metadata.shared = shared;
    canonical.metadata.sharedClass = shared ? 'EXACT_SHARED' : 'EXACT_PRODUCT';
    canonical.metadata.mergedRows = group.reduce(
      (sum, row) => sum + (row.metadata.mergedRows ?? 1),
      0,
    );
    canonical.legacyKeys = [
      ...new Set(group.flatMap((row) => [row.platformKey, ...(row.legacyKeys ?? [])])),
    ].sort();
    canonical.legacySources = [
      ...new Map(
        group
          .flatMap((row) => row.legacySources ?? [])
          .map((value) => [JSON.stringify(value), value]),
      ).values(),
    ];
    if (shared && canonical.domain !== 'shared') {
      const oldKey = canonical.platformKey;
      const slug =
        canonical.localizedValues.en
          .normalize('NFKD')
          .replace(/\p{M}/gu, '')
          .toLowerCase()
          .replace(/[^a-z0-9]/gu, '')
          .slice(0, 40) || 'copy';
      const base = `gopay_shared_${slug}_${canonical.role.replace(/[^a-z0-9]/gu, '') || 'text'}`;
      let key = base;
      for (let n = 2; reserved.has(key); n += 1) key = `${base}_${n}`;
      reserved.add(key);
      canonical.platformKey = key;
      canonical.platformKeySource = 'exact-shared';
      canonical.name = `shared/${key}`;
      canonical.domain = 'shared';
      canonical.collection = 'shared';
      canonical.feature = 'common';
      events.push({
        event: 'rekey',
        copyId: canonical.copyId,
        from: oldKey,
        to: key,
        reason: 'exact-full-locales',
      });
    }
    for (const row of group.slice(1)) {
      row.status = 'archived';
      row.metadata.mergedInto = canonical.copyId;
      row.metadata.sharedClass = 'MERGED_EXACT';
      events.push({
        event: 'merge',
        copyId: row.copyId,
        into: canonical.copyId,
        reason: 'exact-full-locales',
      });
    }
    canonical.legacyKeys = canonical.legacyKeys.filter((key) => key !== canonical.platformKey);
    merges.push({
      copyId: canonical.copyId,
      name: canonical.name,
      shared,
      products,
      originalNames: usages.map((usage) => usage.name),
      mergedIds: group.slice(1).map((row) => row.copyId),
      localizedValues: canonical.localizedValues,
    });
  }
  return { rows, events, merges };
}

export async function readRegistry() {
  return (
    await readFile(resolve(root, 'figma-copy-migration/registry/copy-registry.jsonl'), 'utf8')
  )
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export async function writeLibrary(output = resolve(root, 'figma-copy-migration/reimport')) {
  const source = await readRegistry();
  const { rows, events, merges } = prepareRegistry(source);
  const active = rows.filter((row) => row.status === 'active' && !row.metadata?.importHeld);
  await mkdir(output, { recursive: true });
  await rm(resolve(output, 'collections'), { recursive: true, force: true });
  const collections = new Map();
  const counts = {};
  for (const row of active.sort((a, b) => a.name.localeCompare(b.name))) {
    const stream = product(row);
    const count = counts[stream] ?? 0;
    const collection = count < 4000 ? stream : `${stream}-${Math.floor(count / 4000) + 1}`;
    counts[stream] = count + 1;
    const list = collections.get(collection) ?? [];
    list.push(row);
    collections.set(collection, list);
  }
  const json = async (path, value) => {
    await mkdir(resolve(output, path, '..'), { recursive: true });
    await writeFile(resolve(output, path), `${JSON.stringify(value, null, 2)}\n`);
  };
  for (const [collection, list] of collections) {
    for (const locale of ['en', 'id']) {
      const tokens = {};
      for (const row of list) {
        const group = (tokens[row.name.split('/')[0]] ??= {});
        group[row.platformKey] = {
          $type: 'string',
          $value: row.localizedValues[locale],
          $description:
            `${row.copyId}\n${row.metadata.shared ? 'Shared' : product(row)} › ${row.feature} › ${row.screen} › ${row.context} › ${row.role}` +
            (row.metadata.usages
              ? `\nUsed in: ${[...new Set(row.metadata.usages.map((usage) => usage.product))].join(', ')}`
              : ''),
          $extensions: {
            'com.gopay.copy': { id: row.copyId, platformKey: row.platformKey, status: row.status },
          },
        };
      }
      await json(`collections/${collection}/${locale.toUpperCase()}.json`, tokens);
    }
  }
  await json('merge-map.json', merges);
  await writeFile(
    resolve(output, 'registry.jsonl'),
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
  );
  await writeFile(
    resolve(output, 'merge-events.jsonl'),
    events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  );
  const report = {
    before: source.filter((row) => row.status === 'active' && !row.metadata?.importHeld).length,
    after: active.length,
    exactGroups: merges.length,
    sharedGroups: merges.filter((merge) => merge.shared).length,
    merged: events.filter((event) => event.event === 'merge').length,
    collections: Object.fromEntries([...collections].map(([name, list]) => [name, list.length])),
  };
  await json('analysis.json', report);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await writeLibrary(process.argv[2] ? resolve(process.argv[2]) : undefined);
