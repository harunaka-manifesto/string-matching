import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRegistry, readRegistry, writeLibrary } from '../prepare-copy-library.mjs';

const source = await readRegistry();
const { rows, events } = prepareRegistry(source);
const byId = new Map(rows.map((row) => [row.copyId, row]));
const before = new Map(source.map((row) => [row.copyId, row]));
for (const event of events.filter((event) => event.event === 'merge')) {
  assert.deepEqual(before.get(event.copyId).localizedValues, byId.get(event.into).localizedValues);
  assert.equal(byId.get(event.copyId).metadata.mergedInto, event.into);
  assert.equal(byId.get(event.copyId).status, 'archived');
  assert.ok(byId.get(event.into).legacyKeys.includes(before.get(event.copyId).platformKey));
}
assert.equal(new Set(rows.map((row) => row.copyId)).size, source.length);
assert.deepEqual(prepareRegistry(rows).rows, rows);
assert.deepEqual(prepareRegistry(rows).events, []);
const example = structuredClone(
  source.find((row) => row.status === 'active' && !row.metadata.importHeld),
);
const variant = structuredClone(example);
variant.copyId = 'different-id';
variant.platformKey += '_different';
variant.name += '_different';
variant.localizedValues.id += '!';
assert.equal(prepareRegistry([example, variant]).events.length, 0);
variant.localizedValues = { ...example.localizedValues, en: example.localizedValues.en + ' ' };
assert.equal(prepareRegistry([example, variant]).events.length, 0);
variant.localizedValues = { ...example.localizedValues, vi: 'different locale' };
assert.equal(prepareRegistry([example, variant]).events.length, 0);
console.log(
  `Exact merge verified: ${events.filter((event) => event.event === 'merge').length} redirects; unchanged locale values, IDs, aliases, and idempotency.`,
);

const output = await mkdtemp(join(tmpdir(), 'binder-library-'));
try {
  const report = await writeLibrary(output);
  let emitted = 0;
  for (const collection of await readdir(join(output, 'collections'))) {
    const flatten = (groups) =>
      Object.fromEntries(
        Object.entries(groups).flatMap(([group, tokens]) =>
          Object.entries(tokens).map(([key, token]) => [`${group}/${key}`, token]),
        ),
      );
    const en = flatten(
      JSON.parse(await readFile(join(output, 'collections', collection, 'EN.json'), 'utf8')),
    );
    const id = flatten(
      JSON.parse(await readFile(join(output, 'collections', collection, 'ID.json'), 'utf8')),
    );
    assert.deepEqual(Object.keys(en), Object.keys(id));
    assert.ok(Object.keys(en).length <= 4000);
    for (const [name, token] of Object.entries(en)) {
      const entity = byId.get(token.$description.split('\n')[0]);
      assert.equal(entity.name, name);
      assert.equal(token.$value, entity.localizedValues.en);
      assert.equal(id[name].$value, entity.localizedValues.id);
      emitted += 1;
    }
  }
  assert.equal(emitted, report.after);
  console.log(
    `Import packs verified: ${emitted} bilingual tokens with preserved IDs and collection limits.`,
  );
} finally {
  await rm(output, { recursive: true, force: true });
}
