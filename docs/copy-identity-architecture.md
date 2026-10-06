# GoPay Copy Identity & Naming Architecture

> **2026-10-06:** For authoring, registry transactions, explicit duplicate choices, delivery mirrors and frame MCP handoff, [String Binder implementation specification](string-registry-backend.md) supersedes historical recommendations below. Supabase is authoritative; remote setup is pending.

> **Context.** GoPay copy lives in 7 Google Sheets tabs (~20k copy rows). Writers edit Sheets while designers edit Figma, so there are two sources of truth. The plan is to move editable copy into a Figma Copy Library that uses String Variables, EN/ID modes, a plugin and generated dev bundles. This doc defines how every copy string is identified and named. It is based on programmatic analysis of all 7 supplied CSVs (read-only; no source file was modified).
> Tags used throughout: **[OBS]** = observed in the corpus. **[REC]** = recommended future convention.
> Row references use the form `FILE:rec` (the CSV record number, where the header is record 1; multi-line cells make record ≠ physical line).
> File short names: INVESTMENT, LENDING (3rd Party Lending Platform), INSURANCE, PAYMENT (Payment Experience), USER-SPEND, CONSUMER (Consumer Experience), MONEY (Money Management).

> **Rev 3 (2026-09-29):** the legacy copy is now in Figma as 5 `# Legacy …` collections (16,393 variables). New strings go into per-product collections (e.g. `Transfer`, `Split Bill`) with flat `<platformKey>` names. **For plugin work, [plugin-copy-rules.md](plugin-copy-rules.md) is authoritative and wins on any conflict with this doc.**
>
> **Revision.** Rev 2 (2026-09-29): Figma variable name changed from a 4-level semantic path to `<domain>/<platformKey>` after review — deep group nesting was hard to maintain. Context moved to description.

---

## 1. Executive recommendation

Every copy entity has five layers, and each layer has one job:

| Layer                | What it is                                                                                                                               | Mutable?                                                                      | Who creates it                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| **Copy ID**          | `cp_` + UUIDv7 in Crockford Base32, e.g. `cp_01K9X7…` (26 chars)                                                                         | **Never**                                                                     | Plugin or migration, automatically         |
| **Figma name**       | Figma variable name `<domain>/<platformKey>`, e.g. `transfer/gopay_transfer_ewallet_frequenttransfer_empty_title`. One group level only. | Only the domain prefix (domain move). The key part is **frozen** at creation. | Plugin infers it; writer confirms          |
| **Description**      | Readable context, 3 fixed lines: `cp_<ID>`, `<Domain> › <Feature> › <Screen> › <Context> › <Role>`, optional `Note: …`                   | Yes (plugin regenerates lines 1–2; humans edit line 3 only)                   | Plugin                                     |
| **Localized values** | One Figma mode per locale (`en`, `id`, later `vi`…)                                                                                      | Yes                                                                           | Writers                                    |
| **Metadata**         | role, state, status, platformKey, legacyKey, forkedFrom, shared flag, notes                                                              | Partly                                                                        | Plugin plus a small amount of writer input |

- The ID is generated on the client with no coordination, so concurrent writers are safe by construction.
- The Figma name is the dev key (`platformKey`) with a domain group prefix. It is flat snake_case, already familiar to developers, and keeps the Figma Groups sidebar one level deep. Because the key is frozen, its semantics may go stale; the **description** is the source of truth for context (search and discovery happen in the plugin over description and values).
- Conflicts get deterministic qualifiers (`_cta_primary`) and then ordinals (`_2`, `_3`). The key is unique globally, so the Figma name is unique too.
- A **Copy Registry**, which is an append-only ledger (DB table or JSONL in git), stores every ID ever issued, including tombstones, the Figma variable mapping, and the frozen dev key. Figma is the editing surface. The registry guarantees permanence.
- Reuse happens only in two cases: (a) the variable was explicitly marked **shared**, or (b) the layer is inside a component instance whose main component is already bound. Everything else creates a new entity. Matching text only produces a _suggestion_.
- Migration assigns IDs **once** and persists them in the ledger. Reruns look up the ledger and never regenerate IDs.

---

## 2. Corpus inventory [OBS]

| Metric                                                       | Value                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| CSV files                                                    | 7                                                                                                                  |
| Total CSV records (excl. header)                             | 32,886                                                                                                             |
| Non-empty copy rows (EN or ID filled, excl. section headers) | **20,262**                                                                                                         |
| Rows missing EN / missing ID                                 | 127 / 142                                                                                                          |
| Unique EN (whitespace-normalized)                            | 12,845 (12,786 case-insensitive)                                                                                   |
| Unique ID                                                    | 12,867                                                                                                             |
| Unique EN+ID pairs                                           | 13,438 (of 19,993 bilingual rows)                                                                                  |
| EN strings used >1×                                          | 2,682 strings covering 9,972 rows (49% of EN rows)                                                                 |
| EN+ID pairs used >1×                                         | 2,551 pairs covering 9,106 rows                                                                                    |
| EN strings with >1 distinct ID translation                   | 545                                                                                                                |
| EN strings appearing in ≥2 files / ≥4 files                  | 652 / 93                                                                                                           |
| Rows where EN == ID                                          | 1,589 (867 brand/term, 715 placeholder/number, 7 long untranslated)                                                |
| Multi-line EN cells (e.g. push title + body in one cell)     | 519                                                                                                                |
| EN cells containing emoji                                    | 402                                                                                                                |
| Third language present                                       | VN column in PAYMENT, USER-SPEND and CONSUMER (≈320 cells; some cells contain keys or notes instead of Vietnamese) |

**Rows per product file:** MONEY 4,543 · INSURANCE 4,156 · USER-SPEND 3,355 · CONSUMER 3,143 · PAYMENT 2,322 · INVESTMENT 2,269 · LENDING 474.
**Largest product file:** MONEY. **Largest section/feature:** INSURANCE "Health insurance pre UT" (489 rows), then CONSUMER "Group platform" (369) and INSURANCE "Travel Insurance" (257).
**Sections** (column-A headers): 677 distinct (MONEY 195, CONSUMER 111, USER-SPEND 108, INVESTMENT 86, INSURANCE 85, PAYMENT 85, LENDING 7). Median section has 16 rows; the largest has 489. **Section+screen combos:** 2,703.

**Existing keys**

| Metric                                                               | Value                                                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Rows with a key-shaped value (`^[a-z][a-zA-Z0-9_]*$` containing `_`) | 3,746 (**18.5%**)                                                                                           |
| Unique keys                                                          | 3,449                                                                                                       |
| Keys used on >1 row                                                  | 214 (511 rows): 161 carry an identical EN/ID pair (legit reuse), **53 carry different copy (conflicts)**    |
| Same EN/ID pair carrying >1 different key                            | 223 pairs                                                                                                   |
| Keys with uppercase                                                  | 11 (`…_mainCTA_save`, `…_NPWP`)                                                                             |
| Keys not prefixed `gopay_`                                           | 37 (`go_pay_widget_*`, `vui_*`, `opay_*`, `descgopay…`)                                                     |
| Key length                                                           | min 18, median 46, max 117 characters                                                                       |
| Token count (split by `_`)                                           | 3–12 tokens; the mode is 4 (1,076) and 83% have 4–7                                                         |
| Most common last token                                               | `title` 754, `description` 550, `cta` 511, `toast` 61, `header` 43, `info` 42, `label` 38, `placeholder` 28 |
| Key coverage by file                                                 | USER-SPEND 54% · PAYMENT 22% · CONSUMER 17% · MONEY 14% · LENDING 5% · INSURANCE 4% · INVESTMENT 3%         |

**Context coverage per row** (S = section, C = screen, forward-filled within its section; X = context/role cell; K = key):

| Pattern                    | Rows  | %        |
| -------------------------- | ----- | -------- |
| S C – –                    | 5,381 | 26.6     |
| **S – – –** (section only) | 5,314 | **26.2** |
| S C X –                    | 4,408 | 21.8     |
| S C X K                    | 2,297 | 11.3     |
| S – X –                    | 1,413 | 7.0      |
| S C – K                    | 807   | 4.0      |
| S – – K                    | 430   | 2.1      |
| S – X K                    | 212   | 1.0      |

- Screen is known for 63.6% of rows, but only 12.5% have it stated on the row itself. The rest is inherited by forward-fill.
- Context is filled on 41.1% of rows. A **role** (title/cta/desc/…) can be mechanically inferred from context or key for only **29.1%** of rows.

**Placeholders:** 1,803 rows contain placeholders, written in 5 syntaxes: `<x>` 1,531 · `%s/%d` 447 · `{x}` 239 · `[x]` 58 · `{{x}}` 9. There are also 94 rows that use `X`/`XXXXX` as a placeholder. **129 rows have placeholders that differ between EN and ID.**

---

## 3. Existing structural patterns [OBS]

The implicit hierarchy that actually recurs is:

```
File (org/business unit)  →  Section (col A: feature or sub-flow)  →  Screen (sparse, forward-filled)  →  Context (role or state, free text)  →  EN / ID
```

- **File = business unit, not product.** All 7 files are "GoPay App" and the titles are team-oriented (User Spend, Money Management, Consumer Experience). Features cross files. For example, Term Deposit appears as a section in MONEY but uses `gopay_investment_termdeposit_*` keys. Split bill lives in USER-SPEND ("Lender side").
- **Section = feature / campaign / flow / anything.** It can be a feature (`Travel Insurance`, `Term Deposit`), a flow (`KYC Flow`, `Registration Form`), a component type (`Push Notification`, `Error Messages`, `Toast - not enough balance`), a time-boxed project (`VA Transfer Improvements (Dec '22)`, `Cash Out update 2022`), or even copy text (24 sections are longer than 45 characters, e.g. INSURANCE `Biaya pengobatan mahal`). 96 sections are ALL CAPS.
- **Column A also holds link labels** (`Figma`, `Figma link`, `PRD\nResearch`, `Design Link`), which pollute the hierarchy. 1,069 rows sit under such pseudo-sections.
- **Screen** is a mix of screen names (`Transfer home`, `Payment review`), states (`Error - empty`, `Loading state`, `Has 1 Insurance Subscription`), backend enums (`P2P_VELOCITY_BREACH`, `ATO_RISK`, `403`, `IRT-C04-029`) and components (`Bottomsheet`, `Toast`, `Green slim banner`).
- **Context** has role vocabulary plus free text. The top values are `Title`/`title`, `Desc`/`desc`/`Description`, `CTA`/`cta`/`CTA 1`/`CTA 2`, `Header`, `Placeholder`, `Toast`, `Error - empty`, `Answer`, `Field`. The same column also carries states (`Activated`, `Processing`, `Rejected`, `Within SLA`), variants (`Alt 1`, `Opt 1 - Dynamic`), schedules (`D-7`, `D+1 until D+3 At 12pm`) and instructions (`Same with pre routing FAQ`).
- **The existing developer key grammar** is the strongest structural signal. It is effectively `gopay_<feature>_<screen>_<block…>_<state…>_<role>`, e.g. `gopay_unifiedtransfer_ewallet_emptystate_title` and `gopay_lending_thirdparty_loanactivatedstate_due_section_error_apifailed_description`. The top feature tokens are `splitbill` 501, `promotion` 373, `unifiedtransfer` 336, `group` 208, `insurance` 164, `gopaynext` 114.
- **Column layouts differ in all 7 files**:
  - INVESTMENT `VISUAL,KEYS,SCREEN,CONTEXT,EN,ID`
  - LENDING `Screen,Context,Component,Keys,EN,ID,NOTES`
  - INSURANCE `_,Screen,Context,Key,EN,ID` plus side-by-side alternate EN/ID in columns I/J
  - PAYMENT `Visual,Screen,Context,keys,EN,ID,VN,Keys`, where the "VN" column sometimes holds keys and the second "Keys" column sometimes holds copy
  - USER-SPEND `Visual,_,Screen,Context,EN,ID,Key,VN`, where "Key" is also used for review notes
  - CONSUMER `…,Keys,EN,ID,VN,EXPLORATIONS,NOTES`
  - MONEY `…,Keys,EN,ID,EXPLORATIONS,NOTES`

**Assessment:** the Section→Screen→Context hierarchy is unsuitable as-is. Keep the _concepts_ feature, screen, state/block and role, which match the dev key grammar. Drop file (org) and section (legacy container) as naming levels.

---

## 4. Problems in the current structure [OBS]

1. **No permanent identity.** 81.5% of rows have no key. Row order is the only locator.
2. **Keys are semantic and therefore brittle.** They encode screen names that later change. Examples: typos frozen forever (`…_emptystat_desc` INVESTMENT:47; `gopay_splitbill_gopay_splitbill_confirm_cta`), mixed casing (`mainCTA`), and 3 different prefixes (`gopay_`, `go_pay_`, `vui_`).
3. **Key collisions.** 53 keys map to different copy. For example, `gopay_generic_error_dialoguecard_servererror_cta` = "Got it" in one place and "Retry" in another, and `gopay_promotion_promo_title` = `<promo_title>` and `<voucher_name>`.
4. **The same meaning has many keys.** 223 identical pairs carry multiple keys (e.g. "Admin fee" has 3 keys across investment, parking and review payment).
5. **The same EN is translated inconsistently.** "Got it" has 6 ID variants (`Oke, ngerti` 206, `Oke` 102, …). "Cancel" has 5 (`Gak jadi` 34, `Batal` 23, …). "There's a technical error" has 5. This is a sign that shared entities were never modelled.
6. **Duplicate rows for one entity.** Repeated component blocks are copied per state. For example, "Pinjaman by Kredit Pintar" appears 20× in LENDING, once per loan-card state.
7. **Hierarchy pollution.** 1,069 rows sit under link-label pseudo-sections. Sections include dates, projects and copy text.
8. **Context sparsity.** 26.2% of rows have only a section. Role is inferable for 29%.
9. **Placeholder chaos.** There are 5 syntaxes plus `XXXXX`, and 129 EN/ID placeholder mismatches. Examples:
   - LENDING:236 EN `{used_value}` vs ID `{max_limit_value}`
   - INVESTMENT:382 EN `<n>` vs ID `%s`
   - USER-SPEND:8 `Rp<total_gopay_saved)` is malformed
10. **Content errors.** EN/ID are swapped at LENDING:257 (EN "Ulangi", ID "Reverify"). ID is untranslated at LENDING:450 ("%s dependents"). There are typos such as "Biaya amdin" ×3 and "Detaik".
11. **Multiple entities in one cell.** 519 multi-line cells combine title and body (push notifications), or contain `---`-separated singular/plural variants (INVESTMENT:382).
12. **Explorations mixed with production.** Rows include `Alt 1`/`Alt 2`/`Opt 1`/`(var 1)` (77), side-by-side alternates (INSURANCE columns I/J), and 421 rows flagged `obsolete`/`not used`/`old design`/`revamp`/`to be deleted`.
13. **Column drift.** The same header means different things in different files, so any parser needs a per-tab column map.

---

## 5. Identity model [REC]

```
CopyEntity
├─ id:            cp_<ULID-encoded UUIDv7>    immutable, globally unique, never reused
├─ name:          <domain>/<platformKey>              Figma name; only the domain prefix is mutable; globally unique
├─ description:   3 lines (see below)                 lines 1–2 plugin-generated, line 3 human
├─ collection:    partition (size only)               mutable (e.g. "GoPay Copy 1"); not semantic
├─ domain:        <domain>                            mutable (feature moves); = group prefix
├─ library:       <product>                           mutable only by product merge/split
├─ values:        { en: "...", id: "...", vi?: ... }  one Figma mode per locale; locale never in id/name
└─ meta:
   role           closed vocab (title, cta, …)       inferred
   state          closed-ish vocab (default, empty, error-*, …)
   shared         bool — eligible for AUTO reuse
   status         draft | active | deprecated | archived
   platformKey    dev key AND Figma name suffix (flat snake_case), frozen at creation, globally unique
   legacyKeys[]   imported sheet keys (0..n) and aliases from admin rekeys
   legacySource[] {tab, rec, fingerprint}
   forkedFrom     cp_… | null
   placeholders[] canonical names, e.g. ["amount","date"]
   figma          { fileKey, variableKey, variableId }  (mapping, changes on move)
   createdAt/By, updatedAt/By
```

Responsibilities:

- **ID**: joins across systems (registry, bundles, analytics, Figma pluginData). It is the only thing code or data can rely on permanently.
- **Name (`<domain>/<platformKey>`)**: the Figma name is the dev key with one domain group prefix. It is a browsing handle and a dev key, never the join key. Context and discovery come from the description and plugin search, not from the name.
- **Description**: the human-readable context. Fixed 3-line format:
  ```
  cp_<ID>
  <Domain> › <Feature> › <Screen> › <Context> › <Role>      (human labels, Title Case)
  Note: …                                                     (optional, human-editable)
  ```
  The plugin regenerates lines 1–2 from the registry whenever context changes. Humans may edit line 3 only. The validator checks line 1 == `sharedPluginData` id (V03, V28).
- **Values**: text per locale. Locale is always a mode and never part of the name. The corpus already has a 3rd language (VN), which confirms this.
- **platformKey**: a readable key for engineers that matches today's `gopay_*` practice, and now also the Figma name suffix. It is frozen at creation and not renamed on screen renames or feature moves, so shipping code never breaks. The bundle maps `platformKey → id → values`. A rare admin "rekey" (e.g. fixing a typo) mints a new key and keeps the old one in `legacyKeys` as an alias; the cp_ ID is unchanged. This is why the cp_ ID still exists.
- **Where the ID lives in Figma**: `variable.setSharedPluginData("copy","id", cp_…)` is authoritative. It is also mirrored as the first line of the variable description (`cp_…`) so humans can see it. A validator checks that the two agree.
- **Figma's own variable ID/key is not the copy ID.** It changes when a variable is recreated in another collection or file.

---

## 6. Immutable ID specification [REC]

**Algorithm: UUIDv7 (RFC 9562), text-encoded as Crockford Base32 with the prefix `cp_`.**

| Candidate                               | Collision / concurrency                                                                                              | Offline                 | Survives renames                                               | Sortable   | Verdict                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| **UUIDv7**                              | 48-bit ms timestamp + 74 random bits; no coordination                                                                | Yes                     | Yes                                                            | Yes (time) | **Chosen**                                               |
| ULID                                    | Same properties                                                                                                      | Yes                     | Yes                                                            | Yes        | Equivalent bits, but no RFC and no native DB `uuid` type |
| UUIDv5 (namespace + semantic path/text) | Deterministic, so two writers creating "the same path" get the **same** ID, which silently merges unrelated entities | Yes                     | **No**: the ID stays tied to a path/wording that later changes | No         | Rejected                                                 |
| Semantic hash                           | Same flaw as v5                                                                                                      | Yes                     | No                                                             | No         | Rejected                                                 |
| Path + random suffix                    | Unique, but carries misleading semantics after renames                                                               | Yes                     | Misleading                                                     | No         | Rejected                                                 |
| Central allocation                      | Safe                                                                                                                 | **No** (network needed) | Yes                                                            | Yes        | Unnecessary single point of failure                      |

**Generation:**

1. `u = uuidv7()` using a CSPRNG (`crypto.getRandomValues` in the plugin).
2. Take the 128 bits and encode them big-endian with Crockford Base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`) into 26 characters. The first character is `0`–`7`.
3. `id = "cp_" + encoded`, 29 characters total.

- Regex: `^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$`
- The value always decodes back to a valid UUIDv7 (version nibble `7`, variant `10`), so it can be stored in a Postgres `uuid` column.
- Lexical order equals creation order.

**Rules:**

- IDs are never derived from text, path, locale, row number or counter.
- IDs are never edited and never reused, including after deletion. They are tombstoned in the registry.
- The prefix `cp_` is reserved for copy entities. Future entity kinds get their own prefix (e.g. `cg_` for groups).

---

## 7. Semantic naming specification [REC]

### Placement

- **Library file** = product surface (`GoPay App Copy`; later e.g. `GoPay Merchant Copy`).
- **Domain group** = the single Figma group level, `<domain>/`, drawn from a controlled registry list that is not tied to org units. The initial list is derived from the corpus key prefixes:
  - `shared`
  - `home`
  - `payment` (mpm, cpm, qr, paymentwidget, accountlinking, crossborder)
  - `transfer` (unifiedtransfer, request, withdrawal)
  - `split-bill`
  - `promo` (promotion, coins, vouchers)
  - `insurance`
  - `investment`
  - `savings` (emergencysaving, tabungan, pocket, term deposit)
  - `lending`
  - `finance` (expense report, budget)
  - `account-safety` (sanction, 2fa, pin)
  - `transport` (krl, parking)
  - `group`
- **Collection** = partition for size only (e.g. `GoPay Copy 1`, or one per large domain). Cap each collection at **4,000 variables**. Groups provide the browsing; collections exist only for size limits. When a collection splits, the domain group stays the same.

### Variable name grammar

```
figmaName   = domainGroup "/" platformKey       ; exactly one "/" ; group = kebab domain from the domain registry
domainGroup = 1*(a-z / 0-9) *("-" 1*(a-z / 0-9))   ; e.g. transfer, promo, shared, split-bill

platformKey = "gopay_" domain "_" [feature "_"] [screen "_"] [context "_"] role ["_" qualifier] ["_" ordinal]
token       = 1*(a-z / 0-9)        ; words inside one segment are concatenated without separator (legacy style: unifiedtransfer, emptystate)
domain      = domainGroup with hyphens removed   ; split-bill -> splitbill
feature / screen / context = token    ; inferred as in §8, omitted when default/filler (general, shared, main)
role        = title | subtitle | description | cta | link | label | value | placeholder | helper
            | error | toast | tooltip | banner | badge | tab | option | disclaimer | caption
            | pushtitle | pushbody | sms | emailsubject | emailbody | a11y | text
qualifier   = primary | secondary | tertiary | token   ; joined with underscore: cta_primary, cta_secondary
ordinal     = 2..n                                      ; only on collision (see §9B): _2, _3

regex       ^gopay_[a-z0-9]+(_[a-z0-9]+){1,9}$          ; max 100 chars (legacy max 117 allow-listed)
```

Examples:

- `transfer/gopay_transfer_ewallet_frequenttransfer_empty_title`
- `lending/gopay_lending_thirdparty_loandashboard_limitcarderror_cta`
- `lending/gopay_lending_registration_form_backsheet_cta_primary`
- `shared/gopay_shared_error_servererror_dialog_cta_2`

Rules:

- **Frozen at creation.** The key is now both the Figma name and the dev key. Screen renames and feature moves do **not** rename the key; they update only the description and, for domain moves, the group prefix `<domain>/`. Key semantics may go stale over time; the description is the source of truth for context.
- **Key correction** (e.g. typo `emptystat`) is a rare admin "rekey": a new key is generated, the old key is kept in `legacyKeys` as an alias in bundles, and the cp_ ID is unchanged.
- **Legacy keys** are kept as-is when unique and conflict-free. Their deviations (uppercase, `go_pay_`, `vui_`, `opay_`, length up to 117) are allow-listed.
- **Default/filler segments are omitted** from the key (`general`, `shared`, `main`). Role `text` remains the default when unresolved and flags review.
- **Domain token** in the key is the domain with hyphens removed (`split-bill` → `splitbill`).
- **Uniqueness** is global (see §9B), so the Figma name is unique too.

Rationale:

- One group level keeps the Figma Groups sidebar shallow. Deep nesting such as `adjustedprice / alert / information / text` was hard to maintain (user feedback after review).
- The key style is already familiar to developers: 3,449 legacy keys use `gopay_<feature>_<screen>_…_<role>` with concatenated words.
- Flat names make the name equal to the dev key, so there is one string to copy, search and reference.
- Readable structure (feature › screen › context) lives in the description and is regenerated by the plugin, so it can stay correct even though the key is frozen.

### Description format

```
line 1: cp_<ID>
line 2: <Domain> › <Feature> › <Screen> › <Context> › <Role>     ; human labels, Title Case
line 3: Note: …                                                     ; optional, human-editable
```

Example:

```
cp_01K9X7…
Transfer › E-wallet › Frequent transfer › Empty › Title
Note: shown when the user has no recent recipients
```

The plugin regenerates lines 1–2 (from the registry) on every context change. Humans may edit line 3 only. Omitted defaults (`general`, `shared`, `main`) are shown as human labels or dropped in line 2 as appropriate.

### Normalization (applied to every segment, in this order)

1. Unicode NFKD, then strip diacritics, then ASCII only. Emoji are removed.
2. Symbol replacements: `&` becomes `and`, `+` becomes `plus`, `%` becomes `percent`, `#` becomes `no`. Every other character outside `[a-z0-9]` becomes a hyphen. That includes `/ ( ) ' : . , _ *` and whitespace. Apostrophes are removed rather than hyphenated (`don't` → `dont`).
3. Lowercase. **No camelCase splitting**: `GoPayLater` → `gopaylater`, `QRIS` → `qris`, `OTP` → `otp`, `IDR` → `idr`. Acronyms stay recognizable because they are kept whole.
4. Collapse repeated hyphens and trim leading/trailing hyphens.
5. Numbers stay as digits:
   - `Step 1` → `step-1`
   - `3DS` → `3ds`
   - `D+1` → `d-plus-1`
   - `D-7` → `d-7`
6. Drop noise words from the screen and context segments only: `screen`, `page`, `(new)`, `v2`/`revamp`, dates/years, `figma`, `link`.
7. **Concatenate words within each segment**: remove the remaining hyphens/spaces, so the normalized segment becomes one token (`frequent-transfer` → `frequenttransfer`, `d-plus-1` → `dplus1`). Segments are then joined with `_`. Brand spellings come from the feature registry alias table (e.g. `unifiedtransfer`).
8. Segment token ≤ 32 characters (truncate at a word boundary before concatenation). Full key ≤ 100 characters (legacy max 117 allow-listed).
9. An empty or default segment is omitted (feature `general`, screen `shared`, context `main`). Role stays: an unresolved role becomes `text` (flagged for review).

Figma forbids `.`, `{`, `}` in variable names; the allowed charset `[a-z0-9_-/]` already avoids them.

### platformKey (dev key)

- Generated once at creation from the normalized segments: `gopay_` + domain token + present segments + role (+ qualifier) (+ ordinal), joined with `_`.
- Example: `gopay_transfer_ewallet_frequenttransfer_empty_title`. Figma name: `transfer/gopay_transfer_ewallet_frequenttransfer_empty_title`.
- If the key is already taken anywhere (all collections plus tombstones), a qualifier is tried first, then `_2`, `_3`, and so on (smallest free ordinal; first-created keeps the bare key).
- Never changes afterwards, except through a logged admin rekey (old key kept as a `legacyKeys` alias).
- Legacy rows keep their existing key as `platformKey` when it is unique and conflict-free.

---

## 8. Plugin inference model [REC]

**Authoritative inputs** (trusted): the file's product/domain config (set once per Figma file by an admin), the component main-component name and variant properties, existing bindings, and a layer role from the design system.
**Advisory inputs** (normalized, then shown for confirmation): page, section and frame names.
**Never trusted:** raw text content (except as a reuse signal) and default layer names (`Text`, `Frame 123`).

Segments are inferred exactly as below; the result is normalized, words are concatenated, and default/filler segments are omitted from the key (they stay readable in the description).

| Field                 | Primary source                                                                                          | Fallback                                                                          | Confirm?                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| library / product     | File config (pluginData on document)                                                                    | Figma project → config map                                                        | Never (admin set)                             |
| domain (group prefix) | File config default domain                                                                              | Page-level override in config                                                     | Rare                                          |
| feature               | Section name mapped via feature registry aliases                                                        | Page name → registry alias; else `general`                                        | Sometimes (one-click pick from registry list) |
| screen                | Nearest top-level frame name (normalized)                                                               | Parent frame; `shared` if inside a component outside frames                       | Rare                                          |
| context (block)       | Nearest named ancestor instance/component (e.g. `Bottom sheet`, `Limit card`)                           | Named auto-layout group; else `main`                                              | Rare                                          |
| context (state)       | Variant property `state`/`status`/`type`                                                                | Frame name suffix after `-` / `/` (e.g. `Transfer Review / Error`)                | Sometimes                                     |
| role                  | DS text-style or layer-role token (e.g. `Heading/*` → title, `Button/Label` → cta, `Input/Placeholder`) | Layer name via role vocabulary; position heuristics (first text in sheet → title) | **Only when unresolved**                      |
| qualifier             | Button variant `hierarchy=primary/secondary`                                                            | Order within parent (left/top first)                                              | Rare                                          |
| placeholders          | Parse text for any placeholder syntax and canonicalize to `{snake_name}`                                | —                                                                                 | Only when a new placeholder name is ambiguous |

**Writer interaction** (at most one confirmation, plus at most one choice):

```
Create copy variable
  transfer / gopay_transfer_ewallet_frequenttransfer_empty_title   [edit]
  Transfer › E-wallet › Frequent transfer › Empty › Title
  Similar existing: "Choose your plan" (transfer/gopay_transfer_…_title)  [Use instead]
  [Create]
```

- If the role is unresolved, one radio row is shown: `○ Title ○ Body ○ Button ○ Label ○ Helper ○ Error ○ Other`.
- If the feature is unresolved, one dropdown is shown, filtered from the registry.
- The plugin generates the key from the inferred segments (same inference table, normalized and concatenated per §7) and writes the 3-line description. The writer may edit the key only at creation; afterwards it is frozen.
- **Bulk mode:** "Create for all unbound text in selection" infers everything and shows a single review table. Only rows with unresolved roles are highlighted.

---

## 9. Uniqueness & concurrency [REC]

**A. ID uniqueness (absolute).** UUIDv7 is generated on the client and needs no lock. Each ID has 74 random bits within its millisecond. Even 10⁶ IDs created in the same millisecond give a collision probability of about 10⁻¹¹, and real volume is orders of magnitude lower.

Defence in depth:

1. The registry `copy_id` column has a PRIMARY KEY constraint. The plugin registers on create. On a unique violation, which in practice means a variable was duplicated rather than a random collision, the plugin regenerates the ID for the _newer_ variable and records `forkedFrom`.
2. A nightly validator scans all libraries for duplicated `cp_` IDs across variables.

**Offline:** create locally with `status=draft` and register on the next connect. Figma remains usable without the registry.

**B. platformKey uniqueness: required globally** (across all collections and tombstones). It is enforced by a unique constraint in the registry; since the Figma name is `<domain>/<platformKey>`, the Figma name is unique as well. Resolution is deterministic:

1. Try to disambiguate with a semantic qualifier first: button hierarchy (`cta_primary`/`cta_secondary`), the variant property value, or a named block segment in place of an omitted `main`.
2. If the key is still taken, append the smallest free ordinal starting at `_2` (`_2`, `_3`). The first-created variable keeps the bare key.
3. **Race:** two writers may generate the same key at the same moment. After create, the plugin re-reads the collection and the registry. If a duplicate key exists, the variable whose `cp_` ID sorts later lexically (created later) takes the next ordinal `_n`. Both clients compute the same winner, so no coordination is needed.
4. Ordinals mean "another instance of the same role in the same context". They carry no ranking. The validator warns when there are ≥3 ordinals (V12), which suggests a missing block or qualifier.
5. Once issued, a key is reserved forever (tombstone). It is never reissued, and it never changes except through a logged admin rekey.

---

## 10. Reuse & duplicate rules [REC]

Signals, in order of weight: existing binding on the main component > `shared` flag > same domain+feature+screen+context+role > same role in same feature > identical EN+ID > identical EN > fuzzy EN (token-set ratio ≥ 0.9).

| Outcome                              | Condition                                                                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AUTO REUSE** (no prompt)           | (1) The layer is in an instance whose main component text is bound: the binding is inherited. (2) The selected layer already has a binding. (3) The writer picks a variable from the `shared` collection. |
| **SUGGEST REUSE** (top 3, one click) | Same collection and identical EN (normalized), or the variable is `shared=true` with identical EN, or fuzzy ≥ 0.9 in the same feature.                                                                    |
| **CREATE NEW** (default)             | Everything else, including identical text in a different feature or screen. "Continue" (91 rows, 4 ID variants) must not be merged automatically.                                                         |

- **The `shared` collection** holds only curated, intentionally global strings: generic errors (`gopay_generic_error_dialoguecard_*` is already used across 4 files), common CTAs (`Got it`, `Cancel`, `Try again`, `Retry`), and design-system component labels.
- Promotion to `shared` is a deliberate reviewer action. It is never done automatically.
- Shared variables are the answer to translation drift ("Got it" with 6 ID variants): screens that _intend_ the global wording bind to `shared/…`. Screens that need their own tone keep their own entity.
- **Never auto-reuse on text match alone.**

---

## 11. Lifecycle rules [REC]

| Case                                                                  | ID                              | Figma name / key                                                                                                                                                                                                                                                                           | Other                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Wording changes, same intent                                       | **Same**                        | Same                                                                                                                                                                                                                                                                                       | Values updated. If the _intent_ changes (a different action or message), create a new entity instead.                                                                                                                                              |
| B. Screen renamed (Review Transfer → Transfer Summary)                | Same                            | **Key unchanged, no bulk rename.** Description line 2 is updated (the plugin detects frame-name ≠ description screen and offers "Update 14 descriptions").                                                                                                                                 | Key semantics may go stale; description is the source of truth                                                                                                                                                                                     |
| C. Feature moves domain (Payments/Transfer → Money Movement/Transfer) | Same                            | Group prefix `<domain>/` and possibly the collection change; the key is unchanged. The plugin creates the variable in the target group/collection with the same `cp_` ID, rebinds layers, deletes the old variable, updates the description, and the registry updates the `figma` mapping. | platformKey unchanged                                                                                                                                                                                                                              |
| D. Figma page renamed                                                 | Same                            | **No automatic change.** The page is advisory only.                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                  |
| E. Frame duplicated                                                   | Same                            | Same                                                                                                                                                                                                                                                                                       | Bindings kept (Figma default). The duplicate shares entities.                                                                                                                                                                                      |
| F. Duplicate becomes a new screen (Scheduled Transfer Review)         | Forked entities get **new IDs** | New `cp_` ID and a **new key generated for the new screen**                                                                                                                                                                                                                                | The plugin detects frame name ≠ bound variables' `screen` for ≥50% of the frame's bindings and shows "Fork copy for this screen?". Fork creates new entities with copied values and `forkedFrom`. Bindings to `shared` variables are never forked. |
| G. Variable deleted                                                   | Tombstoned forever              | The key is **reserved forever (tombstone) and not reusable**                                                                                                                                                                                                                               | The ID is never reused.                                                                                                                                                                                                                            |
| H. Deprecated                                                         | Kept                            | Kept                                                                                                                                                                                                                                                                                       | Set `status=deprecated`. The plugin warns on new bindings and the bundle marks it deprecated. After 0 bindings and 0 shipped references for 90 days, it moves to `archived`: removed from Figma, kept in the registry.                             |
| Restore                                                               | Same ID                         | Original key                                                                                                                                                                                                                                                                               | Recreated from the registry snapshot (values + meta)                                                                                                                                                                                               |
| Rekey (admin, rare)                                                   | Same                            | A new key is generated (e.g. fixing typo `emptystat`); Figma name becomes `<domain>/<new key>`. The old key is kept in `legacyKeys` as an alias in bundles.                                                                                                                                | Logged; the only allowed key change after creation                                                                                                                                                                                                 |

---

## 12. Migration strategy [REC]

**Pipeline** (idempotent):

1. **Tab config.** Write an explicit column map per tab, because there are 7 layouts and PAYMENT/USER-SPEND reuse column names for different content. Header autodetection is not reliable.
2. **Row classification:**
   - section header (column A only)
   - link label (`Figma`, `PRD`, `Design Link`, URLs): ignored as hierarchy
   - copy
   - exploration (`Alt n`, `Opt n`, `(var n)`, side-by-side alternates, EXPLORATIONS column): `status=draft`, excluded from bundles
   - obsolete (`obsolete`/`not used`/`to be deleted`/`old design`): `status=archived`
   - instruction/stub (`Etc…`, `Same with pre routing FAQ`): not an entity, becomes a _reuse hint_
3. **Context reconstruction.**
   - Section: forward-fill column A, skipping link labels.
   - Screen: forward-fill within the section.
   - Context: row-level only.
4. **Legacy key parse** (18.5% of rows). The token after `gopay_` becomes a feature alias. The last token becomes the role. The middle tokens become screen/context. This is the strongest automatic signal.
5. **Normalization** to domain/feature/screen/context/role using the feature registry alias table (e.g. `unifiedtransfer`, `Transfer to e-wallet` → transfer/ewallet).
6. **Splitting.**
   - Multi-line push cells (519) split into `push-title` (first line) and `push-body` (rest). These are 2 entities linked by `group`.
   - `---`-separated plural variants are flagged for review and later mapped to ICU plural in one entity.
7. **Placeholder canonicalization.** `<x>`, `{x}`, `%s`, `[x]`, `{{x}}` all become `{snake_name}`. `%s` is named from context or by review. Every EN/ID mismatch (129) goes to review.
8. **Duplicate clustering** (§ below).
9. **ID assignment (Option B).** Look up the ledger by `legacyFingerprint`. If found, reuse the ID. Otherwise generate a UUIDv7 and **append to the ledger before emitting**.
10. **Emit** the registry rows plus a Figma import payload.

**Migration ID stability: Option B, generate once and persist.**

- The ledger maps `legacyFingerprint → cp_ id`, where `legacyFingerprint = sha256(tabId | legacyKey || (section|screen|context|EN|occurrenceIndex))` and `occurrenceIndex` counts identical tuples in document order.
- Rerunning on an unchanged corpus looks up the ledger and yields identical IDs.
- A deterministic UUIDv5 is rejected because any sheet edit between runs, such as a typo fix, would silently mint a _different_ permanent ID.
- The fingerprint is only a lookup key into the ledger. It is never the identity.
- Optional: write the `cp_` ID back into a new sheet column during the freeze period. This happens at migration time, not now.

**Legacy duplicate entities** (measured on this corpus):

| Class                           | Rule                                                                                                              | Count                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **High-confidence same entity** | Same legacy key and same EN+ID pair                                                                               | 161 keys                                                                    |
|                                 | Same tab+section+screen+context+EN+ID, text >20 chars                                                             | 253 groups                                                                  |
|                                 | Repeated component blocks across states (e.g. LENDING "Pinjaman by Kredit Pintar" ×20, "Available limit")         | Merge into 1 entity after reviewer confirmation                             |
| **Possible same entity**        | Same full context, short text ≤20 chars (often per-field repeats like INVESTMENT "This field cannot be empty" ×6) | 514 groups                                                                  |
|                                 | Same tab+section+pair, different screen/context                                                                   | 897 groups / 2,380 rows                                                     |
|                                 | Identical rows with _different_ keys                                                                              | 29 groups                                                                   |
| **Clearly different entities**  | Same EN in different sections/tabs                                                                                | 1,957 EN strings; stay separate, `shared` promotion is a candidate          |
|                                 | Same key with different copy                                                                                      | 53 keys; split into separate entities, one of which inherits the legacy key |

**Needs manual review:**

- rows with section-only context (5,314, 26.2%)
- unresolved role (~71% before key/position heuristics; the target after heuristics is <25%)
- placeholder mismatches (129)
- key conflicts (53)
- EN/ID swaps and untranslated EN==ID long strings (7)
- plural variants
- all "possible" clusters

Everything else is automatic.

---

## 13. Worked examples (from the corpus)

`cp_⟨new⟩` means a freshly generated UUIDv7 at migration. `cp_⟨=#n⟩` means the same ID as example n (merged/reused). No real IDs are invented here.

| #   | Source                                                                              | Context (sec › screen › ctx › key)                                                                                          | EN / ID                                                                            | Figma name                                                                                                        | ID                                   | Reason                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MONEY:827                                                                           | Transfer to e-wallet › Empty state for frequent transfer › Title › `gopay_unifiedtransfer_ewallet_emptystate_title`         | There's no one here / Masih sepi, nih                                              | `transfer/gopay_unifiedtransfer_ewallet_emptystate_title`                                                         | ⟨new⟩                                | Clean empty state; the legacy key is unique and conflict-free, so it is kept as the key (Figma name `transfer/<legacy key>`). Description: Transfer › E-wallet › Frequent transfer › Empty › Title |
| 2   | MONEY:828                                                                           | same › Desc › `…_emptystate_description`                                                                                    | Those you've often transferred will show up here. / Nanti yang…                    | `transfer/gopay_unifiedtransfer_ewallet_emptystate_description`                                                   | ⟨new⟩                                | Sibling of #1; legacy key kept                                                                                                                                                                     |
| 3   | MONEY:4320                                                                          | Transfer – Account Linking › Assigning Contact Page › Placeholder text › `gopay_unifiedtransfer_ewallet_search_placeholder` | Enter name or phone number / Ketik nama atau nomor HP                              | `transfer/gopay_unifiedtransfer_ewallet_search_placeholder`                                                       | ⟨new⟩                                | Screen typo "Assiging" is normalized away in the description; the legacy key is unique and kept as the key                                                                                         |
| 4   | MONEY:921                                                                           | SEARCH › – › "error - failed to show API acc…" › `…_search_allaccounts_error_cantshowsomeaccounts_description`              | Couldn't show some accounts / Beberapa akun gagal muncul                           | `transfer/gopay_unifiedtransfer_search_allaccounts_error_cantshowsomeaccounts_description`                        | ⟨new⟩                                | Missing screen; the legacy key is unique and kept. Screen/state context lives in the description                                                                                                   |
| 5   | MONEY:9                                                                             | 1. EXPENSE MANAGEMENT › Coming soon on GoPay Home › Toast                                                                   | We got your response ✅ / Responmu udah dicatet ✅                                 | `finance/gopay_finance_expense_comingsoonhome_toast`                                                              | ⟨new⟩                                | Numbered/caps section normalized; emoji is kept in the value, never in the name                                                                                                                    |
| 6   | MONEY:6                                                                             | same screen › (none)                                                                                                        | "Forgot where all your money went?\nYea that happens…"                             | `finance/gopay_finance_expense_comingsoonhome_title` + `finance/gopay_finance_expense_comingsoonhome_description` | 2× ⟨new⟩                             | Multi-line cell split into title and body; **review**                                                                                                                                              |
| 7   | PAYMENT:986                                                                         | BCA Blu › Server error › Title › `gopay_generic_error_dialoguecard_servererror_title`                                       | There's a technical error / Ada gangguan teknis                                    | `shared/gopay_generic_error_dialoguecard_servererror_title`                                                       | ⟨new⟩                                | Generic key used in 4 files: seeds the `shared` group. Legacy key kept (unique across files, same pair)                                                                                            |
| 8   | PAYMENT:1553                                                                        | Error states › Installment error › Title › same key                                                                         | There's a technical error / Ada gangguan teknis                                    | → binds #7                                                                                                        | ⟨=#7⟩                                | Same key + same pair: high-confidence same entity                                                                                                                                                  |
| 9   | LENDING:360                                                                         | (Figma) › – › – › `gopay_lending_thirdparty_kycchecking_error_generaltechnical_popup_title`                                 | There's a technical error / Ada masalah teknis, nih                                | `lending/gopay_lending_thirdparty_kycchecking_error_generaltechnical_popup_title`                                 | ⟨new⟩                                | Same EN as #7 but different key and ID tone: **clearly different**; suggest shared                                                                                                                 |
| 10  | USER-SPEND:104                                                                      | Empty State › No promo at all › "CTA (dialogue card only)" › `…_servererror_cta`                                            | Got it / Oke, ngerti                                                               | `shared/gopay_generic_error_dialoguecard_servererror_cta`                                                         | ⟨new⟩                                | Key conflict: this key also maps to "Retry" elsewhere. #10 keeps the legacy key (group `shared`)                                                                                                   |
| 11  | (key conflict partner) `gopay_generic_error_dialoguecard_servererror_cta` = "Retry" | —                                                                                                                           | Retry / …                                                                          | `shared/gopay_shared_error_servererror_dialog_cta_2`                                                              | ⟨new⟩                                | One of the 53 conflicting keys: split. The older/most-used variant (#10) inherits the legacy key; this one gets a new key with ordinal `_2`. **Review**                                            |
| 12  | USER-SPEND:283                                                                      | Error Messages › BE failure › CTA › `…_servererror_cta`                                                                     | Got it / **Oke**                                                                   | → #10 with ID-mode conflict flagged                                                                               | ⟨=#10⟩                               | Same key, ID differs ("Oke" vs "Oke, ngerti"). This is a translation drift: one entity, reviewer picks the value                                                                                   |
| 13  | MONEY:90                                                                            | 1. EXPENSE MANAGEMENT › graph when clicked on a week › –                                                                    | Got it / Oke, ngerti                                                               | `finance/gopay_finance_expense_weeklygraph_cta`                                                                   | ⟨new⟩                                | No key, different feature: create new. It is listed as a shared-promotion candidate (V22: "Got it" is used 321×), but it is only rebound to `shared` if a reviewer promotes it                     |
| 14  | INVESTMENT:390                                                                      | Crypto › dialogue card crypto options › cta                                                                                 | Cancel / Gak jadi                                                                  | `investment/gopay_investment_crypto_options_dialog_cta_secondary`                                                 | ⟨new⟩                                | "Cancel" appears 66× with 5 ID variants; never auto-merged                                                                                                                                         |
| 15  | INVESTMENT:2333,2338,2346,2351                                                      | Gold on Gojek app › – › –                                                                                                   | Cancel / Gak jadi (×4)                                                             | `investment/gopay_investment_goldgojek_cta` (+ `_2`…`_4` if kept)                                                 | **possible** cluster                 | Short text, no screen: 4 dialogs or 1? **Review**. The default keeps them separate as `_2…_4`                                                                                                      |
| 16  | INVESTMENT:931–957                                                                  | Tax Related Question › Error – empty                                                                                        | This field cannot be empty ×6                                                      | `investment/gopay_investment_mutualfund_taxquestions_fieldempty_error`                                            | 1 ⟨new⟩ if reviewer confirms, else 6 | Per-field repeats: **possible**. The recommended outcome is 1 entity reused across fields                                                                                                          |
| 17  | INVESTMENT:5 / :6                                                                   | Investment Landing › money page › Alt 1 / Alt 2                                                                             | Make your money work… / A simple way to start…                                     | `investment/gopay_investment_moneypage_title` (draft ×2; second gets `_2`)                                        | ⟨new⟩ ×2, status=draft               | Explorations are not production; a winner is chosen later and the loser archived                                                                                                                   |
| 18  | INVESTMENT:46                                                                       | Investment Landing › homepage › `gopay_investment_home_transactionhistory_emptystate_title`                                 | Transaction history / Riwayat transaksi                                            | `investment/gopay_investment_home_transactionhistory_emptystate_title`                                            | ⟨new⟩                                | Legacy key kept. EN "Transaction history" is also used in ≥5 files: separate entity                                                                                                                |
| 19  | INVESTMENT:47                                                                       | … `…_emptystat_desc` (typo)                                                                                                 | Once you make an investment…                                                       | `investment/gopay_investment_home_transactionhistory_emptystat_desc`                                              | ⟨new⟩                                | The typo'd legacy key is kept as the key for app compatibility (unique and conflict-free); the description carries the clean context                                                               |
| 20  | INVESTMENT:382                                                                      | Crypto › review payment page                                                                                                | "Please pay within <n> minute\n---\n…<n> minutes" / "Silakan bayar dalam %s menit" | `investment/gopay_investment_crypto_reviewpayment_helper`                                                         | ⟨new⟩                                | Plural variants → ICU plural `{count}`; `<n>`/`%s` mismatch → **review**                                                                                                                           |
| 21  | LENDING:236                                                                         | Figma › – › Activated › Revolving                                                                                           | You have used {used_value} limit / Kamu sudah mencairkan {max_limit_value}         | `lending/gopay_lending_thirdparty_loandashboard_limitcardrevolving_value`                                         | ⟨new⟩                                | Placeholder mismatch: **blocking** validation error                                                                                                                                                |
| 22  | LENDING:77, :82 … (×20)                                                             | Figma › – › Success/Activated/…                                                                                             | Pinjaman by Kredit Pintar                                                          | `lending/gopay_lending_thirdparty_loandashboard_limitcard_title`                                                  | 1 ⟨new⟩                              | Repeated card header across 20 state mocks: high-confidence single entity (component text)                                                                                                         |
| 23  | LENDING:257                                                                         | Figma › KYC Rejected                                                                                                        | EN "Ulangi" / ID "Reverify"                                                        | `lending/gopay_lending_thirdparty_loandashboard_kycrejected_cta`                                                  | ⟨new⟩                                | EN/ID swapped: **review**. Language detection flags it                                                                                                                                             |
| 24  | LENDING:450                                                                         | Registration Form › Answer                                                                                                  | %s dependents / %s dependents                                                      | `lending/gopay_lending_registration_personalinfo_dependents_option_3`                                             | ⟨new⟩                                | EN==ID untranslated plus `%s`: review; option ordinals follow list order                                                                                                                           |
| 25  | LENDING:421, :436                                                                   | Registration Form › Error state                                                                                             | Please choose one first before continue ×4                                         | `lending/gopay_lending_registration_personalinfo_selectrequired_error`                                            | 1 ⟨new⟩                              | Same context and pair across 4 fields: **possible** → 1 entity recommended                                                                                                                         |
| 26  | LENDING:637                                                                         | Registration Form › "For when user tried to change the country code" › Toast › `…_error_phonenumber_countrycode`            | Country code can't be changed / Kode negara gak bisa diganti                       | `lending/gopay_lending_thirdparty_registration_form_page_error_phonenumber_countrycode`                           | ⟨new⟩                                | Context is an instruction and becomes `notes`; role taken from the Component column. Legacy key kept                                                                                               |
| 27  | LENDING:643                                                                         | Registration Form › Primary button › `…_bottomsheet_back_primarycta`                                                        | No, stay here / Gak, lanjut isi                                                    | `lending/gopay_lending_thirdparty_registration_form_page_bottomsheet_back_primarycta`                             | ⟨new⟩                                | Legacy key kept; qualifier semantics come from the button hierarchy (`primarycta` in the legacy key), not an ordinal                                                                               |
| 28  | LENDING ~709 (Push Notification)                                                    | Drop-off before application completed › "D+1 until D+3 At 12pm"                                                             | 📝 Few steps away… \n Let's pick up…                                               | `lending/gopay_lending_thirdparty_push_applicationdropoff_pushtitle` + `…_pushbody`                               | 2× ⟨new⟩                             | Schedule goes to metadata, never into the name; the cell is split                                                                                                                                  |
| 29  | CONSUMER:168                                                                        | sanction › P2P_VELOCITY_BREACH › "Block P2P temporary – P2P velo…"                                                          | Can't transfer to this receiver\nFor your safety…                                  | `account-safety/gopay_accountsafety_sanction_p2pvelocitybreach_blockp2ptemporary_title` + `…_description`         | 2× ⟨new⟩                             | Backend enum screen is normalized; multi-line split                                                                                                                                                |
| 30  | CONSUMER:94                                                                         | GoPay App – Regional Launch › Greeting screen › `gopay_regionallaunch_splashscreen_title`                                   | Say hello to the new GoPay app! / Ini dia…                                         | `home/gopay_regionallaunch_splashscreen_title`                                                                    | ⟨new⟩                                | Key says `splashscreen` but the sheet says `Greeting screen`: the key is frozen legacy, the description (Greeting screen) is the source of truth                                                   |
| 31  | CONSUMER:4                                                                          | GOPAY HOME BANNER › Title › "Feedback, review, survey"                                                                      | HELP US IMPROVE / KAMI BUTUH MASUKANMU                                             | `home/gopay_home_homebanner_feedbacksurvey_badge`                                                                 | ⟨new⟩                                | "Title" in the screen column is a column drift; it is really a banner label. Casing is a value concern                                                                                             |
| 32  | PAYMENT:5                                                                           | ~~PRD Research~~ → MPM › camera access › Title                                                                              | Allow us access to your camera? / Akses ke kamera belum aktif                      | `payment/gopay_payment_mpm_cameraaccess_permission_title`                                                         | ⟨new⟩                                | The link-label pseudo-section is skipped; the real section is "MPM"                                                                                                                                |
| 33  | PAYMENT:1420                                                                        | Alternative I › Total saving (Rp) › `go_pay_widget_promo_total_saving_rp`                                                   | Total saving: Rp%s / Total hemat: Rp%s                                             | `payment/go_pay_widget_promo_total_saving_rp`                                                                     | ⟨new⟩                                | Non-standard prefix (`go_pay_`) allow-listed and kept as the key; `%s` → `{amount}`                                                                                                                |
| 34  | USER-SPEND:8                                                                        | Promo Home › Head card › Saved GoPay                                                                                        | Rp<total_gopay_saved)                                                              | `promo/gopay_promo_home_headcard_saved_value`                                                                     | ⟨new⟩                                | Malformed placeholder `<…)`: **blocking** validation                                                                                                                                               |
| 35  | USER-SPEND:26                                                                       | Promo Home › Vouchers & Packs (home) › available qty › `gopay_promotion_home_availablevoucher_count`                        | <n> available / <n> tersedia                                                       | `promo/gopay_promotion_home_availablevoucher_count`                                                               | ⟨new⟩                                | Legacy key kept; description reads "Vouchers and Packs" (`&` → `and`); `<n>` → `{count}`                                                                                                           |
| 36  | USER-SPEND:2579                                                                     | Lender side › Request & split bill card on home › Title › `gopay_home_requestandsplitbill_title`                            | Request & split bill / Tagih & patungan                                            | `split-bill/gopay_home_requestandsplitbill_title`                                                                 | ⟨new⟩                                | Key says `home` but the section is split-bill: the group (`split-bill/`) comes from the file config of the Figma file hosting the design; the legacy key is kept                                   |
| 37  | INSURANCE:1405/1406                                                                 | autodebit insurance › Push Notification › "Remind users before deduction"                                                   | Your due date is coming 😊 / Hey {first name}…                                     | `insurance/gopay_insurance_autodebit_push_predeductionreminder_pushtitle` / `…_pushbody`                          | 2× ⟨new⟩                             | Placeholder `{first name}` → `{first_name}`; title/body are separate rows here, so no split is needed                                                                                              |
| 38  | INSURANCE:1620                                                                      | family plan › – › `gopay_insurance_familyplan_registrationpage_mainCTA_save`                                                | Save / Simpan                                                                      | `insurance/gopay_insurance_familyplan_registrationpage_mainCTA_save`                                              | ⟨new⟩                                | Uppercase legacy key kept (allow-listed); it is unique, so no new key is needed                                                                                                                    |
| 39  | INSURANCE:6 & :239 (×6)                                                             | Health insurance pre UT › various                                                                                           | GoPay Asuransi / GoPay Asuransi                                                    | `insurance/gopay_insurance_health_onboarding_hero_title` …                                                        | separate ⟨new⟩                       | EN==ID brand term; the 6 uses sit in different screens and explorations, so they are **clearly different** entities (explorations → draft)                                                         |
| 40  | USER-SPEND:1608                                                                     | Secure Parking › Scanned ticket › CTA › `gopay_secureparking_confirmticket_cta`                                             | Confirm to proceed / Konfirmasi untuk lanjut                                       | `transport/gopay_secureparking_confirmticket_cta`                                                                 | ⟨new⟩                                | Legacy key kept. "Confirm" family (22 rows) is similar but not identical: suggestion only                                                                                                          |

---

## 14. Validation specification [REC]

Each rule has an ID, a scope and a severity. **E** = blocks publish/export. **W** = warning.

| ID  | Rule (machine-testable)                                                                                                                                                                                                                             | Sev             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| V01 | Every entity `id` matches `^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$` and decodes to a UUID with version=7, variant=0b10                                                                                                                                     | E               |
| V02 | `id` is unique across all libraries and the registry, including tombstones                                                                                                                                                                          | E               |
| V03 | Figma `sharedPluginData(copy,id)` == first line of the description == registry `figma.variableKey → id` mapping                                                                                                                                     | E               |
| V04 | No two Figma variables carry the same `cp_` ID (duplicate-variable detection)                                                                                                                                                                       | E               |
| V05 | **Accidental regeneration:** for every registry entry with a `figma.variableKey` that still exists, the ID on that variable is unchanged since the last snapshot                                                                                    | E               |
| V06 | **Deleted-ID reuse:** no active entity's `id` or `platformKey` equals a tombstoned one                                                                                                                                                              | E               |
| V07 | Figma name matches `^[a-z0-9]+(-[a-z0-9]+)*/<platformKey>$` (exactly one `/`) and the part after `/` == the entity's `platformKey`                                                                                                                  | E               |
| V08 | `platformKey` ≤100 chars, matches `^gopay_[a-z0-9]+(_[a-z0-9]+){1,9}$` (legacy keys up to 117 chars and legacy deviations — uppercase, `go_pay_`, `vui_`, `opay_` — are allow-listed)                                                               | E               |
| V09 | `platformKey` is globally unique across all collections and tombstones (registry unique constraint); consequently the Figma name is unique. The key never changes after creation except through a logged admin rekey (old key kept in `legacyKeys`) | E               |
| V10 | The group prefix (before `/`) ∈ domain registry, and equals the entity's domain; for non-legacy keys the domain token of the key == group with hyphens removed                                                                                      | E               |
| V11 | For non-legacy keys, the last role token (ignoring `_primary/_secondary/_tertiary` qualifier and `_n` ordinal) ∈ role vocabulary; an ordinal `_n` is present only if the bare key exists                                                            | E               |
| V12 | ≥3 ordinals on the same key stem                                                                                                                                                                                                                    | W               |
| V13 | `en` is non-empty for `status ∈ {active, deprecated}`                                                                                                                                                                                               | E               |
| V14 | Every required locale (config list, currently `en`, `id`) is non-empty for `active`                                                                                                                                                                 | E (W for draft) |
| V15 | Placeholder set (canonical `{snake}`) is identical across all locales                                                                                                                                                                               | E               |
| V16 | No legacy placeholder syntax (`<x>`, `%s`, `[x]`, `{{x}}`, `XXXXX`) in values                                                                                                                                                                       | E               |
| V17 | No unbalanced delimiters (`<…)`, `{…` without `}`)                                                                                                                                                                                                  | E               |
| V18 | Name, platformKey and id contain no locale codes as segments (`/en`, `_id$`, etc.)                                                                                                                                                                  | E               |
| V19 | Value language check: the `en` value is not detected as Indonesian and vice versa (catches swaps like LENDING:257)                                                                                                                                  | W               |
| V20 | `en == id` for strings >30 chars without placeholders (likely untranslated)                                                                                                                                                                         | W               |
| V21 | **Duplicate-entity candidates:** same collection+feature+screen+context+role and identical normalized values → report                                                                                                                               | W               |
| V22 | Same normalized EN in ≥5 non-shared entities → "shared promotion candidate" report                                                                                                                                                                  | W               |
| V23 | _(merged into V07/V09: key frozen after creation; only a logged rekey may change it)_                                                                                                                                                               | —               |
| V24 | `status=archived` entities have 0 Figma bindings; `deprecated` entities do not gain new bindings (binding count must not grow)                                                                                                                      | W               |
| V25 | `forkedFrom`, when set, references an existing or tombstoned ID ≠ self                                                                                                                                                                              | E               |
| V26 | Migration idempotency: running migration twice on the same input yields byte-identical `(legacyFingerprint → id)` maps                                                                                                                              | E (CI test)     |
| V27 | Values contain no multi-message packing (`\n---\n`)                                                                                                                                                                                                 | W               |
| V28 | Description line 1 == the entity's `cp_` id; line 2 is present and matches the registry context (`<Domain> › <Feature> › <Screen> › <Context> › <Role>`); line 3, if present, starts with `Note:`                                                   | E               |

---

## 15. Final implementation contract

```text
IDENTITY
- Use UUIDv7 (RFC 9562), CSPRNG, generated client-side, encoded as "cp_" + 26-char
  Crockford Base32 (uppercase). Regex ^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$.
- Store it in Figma variable sharedPluginData("copy","id"), mirror it in the description,
  and register it in the append-only Copy Registry (PK on id, tombstones kept forever).
- Figma variable IDs/keys are mappings, never identity.

NAMING
- Library = product. Domain group = the single Figma group level `<domain>/` from the domain
  registry. Collection = size partition only (≤4,000 vars each, e.g. "GoPay Copy 1"); the
  domain group is unchanged when a collection splits.
- Figma variable name = "<domain>/<platformKey>" (exactly one "/"). platformKey is flat
  snake_case: "gopay_" domain ["_" feature] ["_" screen] ["_" context] "_" role
  ["_" qualifier] ["_" ordinal]; words inside a segment are concatenated; domain token = domain
  without hyphens; default/filler segments (general, shared, main) are omitted; role "text"
  is the flagged default. Regex ^gopay_[a-z0-9]+(_[a-z0-9]+){1,9}$, ≤100 chars (legacy ≤117
  and legacy deviations allow-listed).
- Normalize: NFKD→ASCII, & → and, + → plus, % → percent, other symbols → "-", lowercase,
  no camelCase split, then concatenate words per segment; segment ≤32.
- Readable context lives in the variable description (3 lines): "cp_<ID>" /
  "<Domain> › <Feature> › <Screen> › <Context> › <Role>" / optional "Note: …". The plugin
  regenerates lines 1–2; humans edit line 3 only.
- The key is FROZEN at creation. Screen renames and feature moves update only the description
  (and the group prefix for domain moves). Legacy keys are kept when unique and conflict-free.
  Key correction = rare admin rekey (new key, old key kept in legacyKeys alias, cp_ ID unchanged).
- Locale is only ever a Figma mode. It never appears in id, name or platformKey.

INFERENCE PRIORITY
- product/domain: file config > project map.
- feature: section → registry alias > page → alias > "general".
- screen: top-level frame > parent frame > "shared".
- context: named ancestor component/instance + state variant > frame suffix > "main".
- role: DS text style/layer role > layer name vocab > position heuristic > ask
  (single radio).
- Ask the writer at most one confirmation plus at most one choice.

COLLISIONS
- ID: none by construction. A PK violation means a duplicated variable: the newer one gets
  a new ID + forkedFrom.
- Key: platformKey is globally unique (all collections + tombstones, registry unique
  constraint), so the Figma name is unique too. Semantic qualifier first (cta_primary),
  then the smallest free ordinal from _2 (first-created keeps the bare key). On a race,
  re-read collection + registry; the later cp_ (lexical) takes the next ordinal _n.

DUPLICATES / REUSE
- AUTO reuse only for inherited component bindings, existing bindings, or explicit picks
  from `shared`.
- SUGGEST on identical normalized EN in the same collection or on shared, or fuzzy ≥0.9
  in the same feature.
- Otherwise CREATE NEW. Shared promotion is a manual reviewer action.

LIFECYCLE
- Wording/screen/feature/page changes keep the ID and the key. Screen rename / feature move
  update only the description (and the domain group prefix for domain moves); no bulk key
  renames.
- Fork (duplicated frame becoming a new screen) creates new IDs and new keys with forkedFrom;
  shared bindings are never forked.
- Delete = tombstone; the key is reserved forever and never reissued. Deprecate → archive after 90 days with 0 bindings/refs. Restore
  reuses the original ID.

MIGRATION
- Explicit per-tab column maps. Classify rows (copy / section / link / exploration /
  obsolete / instruction).
- Forward-fill section (skip link labels) and screen. Parse legacy keys. Split multi-line
  push cells. Canonicalize placeholders to {snake}.
- Assign IDs once through the ledger keyed by legacyFingerprint (Option B). Reruns reuse
  them. Deterministic v5 IDs are rejected.
- Route to review: key conflicts, placeholder mismatches, possible-duplicate clusters,
  section-only rows, unresolved roles, EN/ID swaps.

NEVER
- Never derive an ID from text, path, locale, row number or counter.
- Never reuse or edit an ID.
- Never auto-merge on text match.
- Never trust page names or default layer names as authoritative.
- Never put locale, schedule or explorations into names.
- Never rename a key except through a logged admin rekey.
- Never let a writer type an ID.
```

---

## Scalability check [REC] (supports §7/§9)

| Scale | Collections (≤4k)                                                    | Key collisions                                | Dev consumption                                                     | Notes                                                              |
| ----- | -------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 10k   | ~5–14 domains, 1 library                                             | Rare; ordinals only in dense generic areas    | 1 bundle per locale per domain                                      | Today's corpus is ~13k unique pairs                                |
| 50k   | ~15–25 collections; split big domains (insurance, transfer)          | Ordinal warnings (V12) surface missing blocks | Per-domain lazy bundles                                             | Registry is trivial (<100 MB)                                      |
| 100k  | ~30 collections; ≥2 library files per product                        | Same                                          | Codegen typed constants per domain                                  | Figma library size/perf is the limiter, not identity               |
| 500k  | ~125+ collections across per-domain library files; multiple products | Same rules                                    | Bundles per product × domain × locale; IDs are fixed-width 29 chars | UUIDv7 unchanged; registry indexed on id and unique on platformKey |

Names are flat within one domain group, so the Figma sidebar stays one level deep at every scale; browsing and search happen through the plugin over description and values, not through deep groups. Domain groups are unchanged when a collection splits. The identity model does not change at any scale. Only the partitioning of collections and library files grows. New languages only add modes. Figma mode and variable caps depend on plan tier, so verify current limits before rollout.

## Verification of this analysis

- All statistics come from Python `csv` parsing of all 7 files (per-tab column maps, whitespace-normalized comparisons). Re-derive them with the same rules during migration tool development and assert the §2 numbers as fixtures.
- Heuristic caveat: the section/screen forward-fill and the "link-label" detection are approximations. Counts in §2–§4 that depend on them (sections, context combos, duplicate clusters) are ±a few percent.
