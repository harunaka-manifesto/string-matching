# Copy variable rules for the Figma plugin (handoff)

> **2026-10-02 update:** Search is strictly scoped to the selected product plus Shared. The user authorized exact full-locale duplicate consolidation, superseding the older reviewer-only promotion rule for this prepared migration. See [replacement import guide](../figma-copy-migration/reimport/README.md) and [concurrent authoring plan](string-registry-backend.md). Original imported variables remain in place until migration; the hosted registry and library sync workflow described there are future implementation, not deployed functionality.

Status: **authoritative for plugin work** as of 2026-09-29. Where this file conflicts with [copy-identity-architecture.md](copy-identity-architecture.md), this file wins. The architecture doc explains _why_; this file states _what the plugin must do today_.

Terms:

- **[DONE]** means the step is finished and verified in Figma.
- **[RULE]** means the plugin must follow it.
- **[OPEN]** means the user still has to decide.

---

## 1. Current state in Figma [DONE]

All legacy copy from the 7 Google Sheets tabs is already imported into the Figma library file **"GoPay Strings"** as String Variables. It sits in 5 collections that the user renamed with a `# Legacy` prefix:

| Collection (exact Figma name, may be truncated in UI) | Variables | Groups inside                                                 |
| ----------------------------------------------------- | --------- | ------------------------------------------------------------- |
| `# Legacy 1: Finance, Insurance, Shared`              | 3,743     | finance, insurance, insurance-health-insurance-pre-ut, shared |
| `# Legacy 2: Account, Split bill, Transfer`           | 3,641     | account-safety, split-bill, transfer                          |
| `# Legacy 3: Group, Payment, Savings`                 | 3,837     | group, payment, savings                                       |
| `# Legacy 4: Home, Lending, Promo, Transport`         | 3,864     | home, lending, promo, transport                               |
| `# Legacy 5: Investment`                              | 1,308     | investment                                                    |

Total: **16,393 variables**.

- Source files: `figma-copy-migration/import-packs/pack-*/{EN,ID}.json`.
- Per-entity truth: `figma-copy-migration/registry/copy-registry.jsonl`, which holds 20,602 entities including archived, merged and held ones.

What an imported legacy variable looks like:

- **Name:** `<group>/<platformKey>`, e.g. `home/gopay_accessibilityfraud_header`. There is exactly one group level. The legacy group names are domain names (home, lending, …), not the new product names.
- **Modes:** `ID` and `EN`. In the Figma UI the **ID column comes first**. Always resolve modes **by name, never by index**.
- **Description** (if Figma kept it on import; verify): line 1 is `cp_<ID>`, line 2 is `Domain › Feature › Screen › Context › Role`, and line 3 is an optional `Note: …`.
- **Not present yet:** `sharedPluginData("copy","id")`. Native import cannot write plugin data. The plugin must backfill it (see §4).

## 2. Where new strings go [RULE]

1. **Never create new variables in a `# Legacy …` collection.** Legacy collections are append-closed.
   - Legacy variables may still be edited: text, bindings, deprecation.
   - Legacy variables may be bound to new layers (reuse, see §5).
2. **New strings go into a per-product collection** whose name is the human product name, e.g. `Transfer` or `Split Bill`.
   - The plugin creates the collection on first use if it is missing.
   - A new collection gets modes named exactly `EN` and `ID`. More locales are added later as extra modes.
3. **The product list is not final [OPEN].** The user will supply the list of product names.
   - Until then, the plugin must read products from one config list, e.g. a `PRODUCTS` constant or plugin settings. Never hard-code names in logic.
   - Each config entry needs these fields:
     ```
     { displayName: "Split Bill",        // exact Figma collection name
       keyToken:    "splitbill",         // used in platformKey, [a-z0-9]+, unique, frozen once used
       legacyGroups: ["split-bill"] }    // legacy groups whose strings belong to this product (for reuse search)
     ```
   - If the product for a selection cannot be inferred, ask the writer with **one dropdown** of `displayName`s. See §3 for the inference order.
4. **Collection size cap:** 4,000 variables per product collection. When the cap is reached, create `<Product> 2` (e.g. `Transfer 2`). Keys and IDs don't change.

## 3. Naming a new variable [RULE]

**Variable name:** `<platformKey>`, flat, with **no group**. The collection already equals the product, so an extra group would only add nesting. The user asked to keep nesting shallow.

- **[OPEN]** If the user later wants one group level (e.g. feature) inside product collections, the name becomes `<feature>/<platformKey>`. The key stays the same.

**platformKey grammar**, for new strings only (legacy keys are kept as they are):

```
gopay_<productToken>[_<feature>][_<screen>][_<context>]_<role>[_<qualifier>][_<n>]
```

- Each segment is lowercase ASCII `[a-z0-9]`. Words inside a segment are concatenated with no separator (`frequenttransfer`). Segments are joined with `_`.
- `productToken` comes from the product config `keyToken`.
- **Omit** `feature`, `screen` or `context` when it:
  - is empty or filler (`general`, `shared`, `main`),
  - equals the product token,
  - equals the previous segment.
- `role` is one of: `title subtitle description cta link label value placeholder helper error toast tooltip banner badge tab option disclaimer caption pushtitle pushbody sms emailsubject emailbody a11y text`.
  - `text` is only the fallback. The plugin should ask for the role (one radio row) instead of falling back when it can.
- `qualifier` is one of `primary`, `secondary` or `tertiary`, taken from button hierarchy.
- `_n` is a collision ordinal starting at `_2`. The first-created variable keeps the bare key.
- Maximum 100 chars. If longer, truncate `context` first, then `screen`.
- Regex: `^gopay_[a-z0-9]+(_[a-z0-9]+){1,9}$`.
- Normalization order:
  1. NFKD to ASCII.
  2. `&` → `and`, `+` → `plus`, `%` → `percent`.
  3. Drop other symbols and emoji.
  4. Lowercase. Don't split camelCase (`GoPayLater` → `gopaylater`).
  5. Keep digits (`step 1` → `step1`).
- **Frozen at creation.** Renaming a screen or moving a feature does **not** change the key. Update the description instead.
  - Correcting a key (rekey) is a rare admin action. The old key is kept as an alias in the registry, and the ID doesn't change.

**Inference sources**, in priority order. Never trust default layer names such as "Text" or "Frame 12".

| Field     | Primary                                                                          | Fallback                                                |
| --------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| product   | file or page config mapping to product                                           | one dropdown                                            |
| feature   | Figma section name mapped through the product's feature aliases                  | page name; otherwise omitted                            |
| screen    | top-level frame name                                                             | parent frame; otherwise omitted                         |
| context   | nearest named component or instance (e.g. "Bottom sheet") plus a `state` variant | frame-name suffix; otherwise omitted                    |
| role      | design-system text style or layer role                                           | layer-name vocabulary; otherwise ask with one radio row |
| qualifier | button `hierarchy` variant                                                       | none                                                    |

**Writer UX:** one confirmation screen showing the key and the description line, plus at most one question (product _or_ role). Writers never type IDs or keys. Editing the key before creation is allowed and gets validated.

**Description**, written and regenerated by the plugin:

```
cp_<ID>
<Product> › <Feature> › <Screen> › <Context> › <Role>
Note: <optional, the only line humans may edit>
```

## 4. Identity [RULE]

- Every variable, legacy or new, has one immutable **Copy ID**: `cp_` + UUIDv7 in Crockford Base32.
  - Regex: `^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$`.
  - Generate it on the client with a CSPRNG. No counters, no network needed. Never derive it from text, path or locale. Never reuse it, even after deletion.
- Store the ID in `variable.setSharedPluginData("copy", "id", <cp_…>)` (authoritative) **and** as description line 1.
- **Backfill for legacy variables:**
  1. On first run in the library file, for every variable in a `# Legacy …` collection, read the `cp_` ID from description line 1.
  2. If the description is missing, look the ID up in `copy-registry.jsonl` by `name` (`<group>/<platformKey>`).
  3. Write the ID to sharedPluginData.
  4. Report any variable that can't be resolved. Never mint a new ID for a legacy variable.
- Figma's own `variable.id` and `variable.key` are mappings only. They change if a variable is recreated.
- **Duplicated variable detection:** two variables carrying the same `cp_` means one was duplicated. The newer one gets a new ID and records `forkedFrom`.

## 5. Reuse before create [RULE]

Search order when a writer creates copy for a layer:

1. If the layer or its main component is already bound, keep the binding (auto).
2. If the text matches an entry in the legacy `shared` group (382 curated shared strings, e.g. `shared/gopay_shared_topup_cta`), **suggest** it first.
   - The match is on normalized text: case-insensitive, trailing `?!.:…` ignored, `&` = `and`, `okay` = `ok`.
3. Also suggest identical normalized EN in the same product. That covers the product's own collection plus its `legacyGroups` in the legacy collections.
4. Otherwise **create new**. Never auto-reuse because the text alone matches. The same "Continue" in two products is two entities unless the writer picks the shared one.
5. Only a reviewer can promote a string to `shared`. The plugin never promotes automatically.

## 6. Placeholders [RULE]

- Canonical syntax: `{snake_case_name}`, identical across all modes.
- 922 legacy values contain `{…}` inside sentences. They imported fine.
- Don't create a variable whose whole value is only `{placeholder}`. That's a data slot, not copy. 296 of these were archived during migration on purpose.
- Validate before saving:
  - the same set of placeholders in EN and ID,
  - no legacy syntax (`<x>`, `%s`, `[x]`, `{{x}}`, `XXXXX`),
  - balanced braces.

## 7. Lifecycle [RULE]

| Event                          | ID                         | Key/name             | Other                                                                                                            |
| ------------------------------ | -------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Wording edited                 | same                       | same                 | —                                                                                                                |
| Screen renamed / feature moved | same                       | same                 | Regenerate description line 2                                                                                    |
| Moved to another product       | same                       | same key             | Create in the target collection with the same `cp_`, rebind layers, delete the old variable, update the registry |
| Frame duplicated               | same                       | same                 | Bindings are kept                                                                                                |
| Duplicate becomes a new screen | **new** IDs + `forkedFrom` | new keys             | Suggest a fork when ≥50% of bindings' description screens ≠ the frame name. Never fork `shared` bindings         |
| Deprecated                     | same                       | same                 | Warn on new bindings. Archive after 90 days with 0 bindings                                                      |
| Deleted                        | tombstoned forever         | key reserved forever | Never reused                                                                                                     |

## 8. Registry and migration artifacts

- `figma-copy-migration/registry/copy-registry.jsonl` holds the current truth per entity: `copyId`, `name`, `platformKey`, `legacyKeys` (aliases), `localizedValues`, `metadata.mergedInto`, `metadata.removedReason`, `status`.
- `figma-copy-migration/registry/migration-ledger.jsonl` is **append-only**. Never edit or delete it. It holds the fingerprint → ID mapping plus `rekey` and `merge` events.
  - Reruns of `scripts/copy-migration/migrate.py` read it, so IDs and keys never regenerate.
- The plugin needs a registry it can write to for new entities. The target is a DB table with unique constraints on `copyId` and `platformKey`, tombstones included. **[OPEN]** The backend is not chosen yet.
  - Until one exists, the Figma variables themselves plus sharedPluginData are the source of truth for new strings.
  - A periodic export must append them to the registry.
- Key uniqueness is **global**: across legacy and product collections, and including tombstones and every alias in `legacyKeys`.
- On a collision race, re-read after create. The variable whose `cp_` ID sorts later takes the next `_n`.

## 9. Known leftovers (not the plugin's job to fix)

- 14,067 legacy entities have role `text` with ordinal keys, e.g. `gopay_insurance_familyplan_text_12`. Keys are frozen. Fix readability through the description and the Note line, not renames.
- 571 open `AMBIGUOUS_SHARED_CANDIDATE` rows are values: prices, amounts and ranks. They stay contextual.
- The full review list is `figma-copy-migration/reports/review-required.csv`.

## 10. Open decisions (ask the user)

1. The final product list: `displayName`, `keyToken` and `legacyGroups`.
2. Whether product collections get one group level (`<feature>/<key>`) or stay flat. The default is flat.
3. The registry backend for new strings.
4. Whether legacy variables should eventually move into product collections. The default is no: they stay in `# Legacy …`.
