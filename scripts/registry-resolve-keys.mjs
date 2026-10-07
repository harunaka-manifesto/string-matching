// Decides the single owner of every historical key claimed by more than one identity.
// Writes a reviewable file; bootstrap applies exactly what that file says and nothing else.
// No identity is created, merged or deleted here.
import { writeFile } from 'node:fs/promises';
import {
  LEDGER_PATH,
  RESOLUTIONS_PATH,
  keyClaims,
  loadRecords,
  readJsonl,
} from './registry-records.mjs';

const { records, byId, canonicalId } = await loadRecords();

// The ledger is append-only: the first identity recorded with a key AS ITS OWN KEY had it
// first. Merely listing a key among legacy keys proves nothing; split rows all list it.
const firstCarrier = new Map();
for (const event of await readJsonl(LEDGER_PATH)) {
  if (!event.copyId) continue;
  for (const key of [event.platformKey, event.from, event.to])
    if (typeof key === 'string' && !firstCarrier.has(key)) firstCarrier.set(key, event.copyId);
}

const rank = { active: 0, deprecated: 1, held: 2, draft: 3, archived: 4, merged: 5, deleted: 6 };
const resolutions = [];
const blocked = [];
for (const [key, claim] of keyClaims(records, canonicalId)) {
  if (claim.owners.size < 2) continue;
  const holders = [
    ...new Set(claim.claimants.filter((r) => r.platformKey === key).map((r) => r.copyId)),
  ];
  if (holders.length > 1) {
    blocked.push(key);
    continue;
  }
  const original = firstCarrier.has(key) ? canonicalId(firstCarrier.get(key)) : null;
  let owner = null,
    rule;
  if (holders.length) {
    // A current developer key is globally unique, so its holder (or the identity that
    // holder was merged into) is the only possible owner.
    owner = canonicalId(holders[0]);
    rule = 'current-key';
  } else if (original && claim.owners.has(original)) {
    owner = original;
    rule = 'ledger-former-key';
  } else rule = 'ambiguous';
  // Ambiguous keys still need a reservation row; the choice is stable but carries no meaning.
  const reservedFor =
    owner ??
    [...claim.owners].sort(
      (a, b) => rank[byId.get(a).status] - rank[byId.get(b).status] || a.localeCompare(b),
    )[0];
  resolutions.push({
    key,
    rule,
    owner,
    ...(owner ? {} : { reservedFor }),
    released: claim.claimants
      .filter((r) => r.platformKey !== key && (!owner || canonicalId(r.copyId) !== owner))
      .map((r) => r.copyId)
      .sort(),
  });
}
if (blocked.length)
  throw new Error(
    `Two identities currently use the same developer key (${blocked.join(', ')}). That is a registry defect, not a history question; fix the source registry.`,
  );
resolutions.sort((a, b) => a.key.localeCompare(b.key));
await writeFile(
  RESOLUTIONS_PATH,
  JSON.stringify(
    {
      schemaVersion: 1,
      rules: {
        'current-key':
          'An identity uses this as its current developer key. It (or the identity it was merged into) owns the key; other identities stop listing it as an alias.',
        'ledger-former-key':
          'No identity uses it as a current key. The migration ledger shows one claimant once had it as its own key; that identity keeps it.',
        ambiguous:
          "The legacy sheet used this key for several different strings (for example a push title and its body) and no claimant ever had it as its own key. The key stays reserved forever but is no identity's alias, so the plugin asks instead of guessing.",
      },
      resolutions,
    },
    null,
    2,
  ) + '\n',
);
const counts = {};
for (const r of resolutions) counts[r.rule] = (counts[r.rule] ?? 0) + 1;
console.log(JSON.stringify({ written: RESOLUTIONS_PATH, resolved: resolutions.length, counts }));
