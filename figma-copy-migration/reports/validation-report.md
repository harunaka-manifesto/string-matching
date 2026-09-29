# Validation report

Overall technical status: **PASS**
Content review outstanding: **703 entities held from import, 15421 entities with review items** => migration is **PARTIAL (content review pending)**

## Rules

| Rule | Result | Detail |
|---|---|---|
| PKG-JSON-PARSE | PASS |  |
| PKG-TOKEN-TYPES | PASS | 0 non-string tokens |
| PKG-EN-ID-PARITY | PASS |  |
| PKG-NORMALIZED-DUPLICATES | PASS | 0 |
| PKG-COLLECTION-CAP | PASS | {} |
| V01 | PASS | 0 bad format, 0 bad version/variant |
| V02 | PASS | 20602 entities, 20602 unique ids |
| V07 | PASS | name == <collection>/<platformKey> |
| V07b-SEMANTIC-PATH | PASS | legacy 4-segment path preserved |
| V07c-NAME-CHARS | PASS | 0 names with . { } or $ prefix |
| V08 | PASS | exactly one group level |
| V09 | PASS | 0 duplicate (collection,name) |
| V10 | PASS | 0 violations (feature registry is auto-derived from section/key; alias curation is pending human review) |
| V11 | PASS | 0 bad leaf roles |
| V11b-UNRESOLVED-ROLE | WARN | 14067 entities carry fallback role 'text' (architecture default, flagged for review) |
| V13 | PASS |  |
| V14 | PASS |  |
| V14-draft | PASS | 0 emitted drafts with a missing locale (empty string emitted, not invented) |
| V15 | PASS | emitted entities |
| V16 | PASS | 0 emitted values with legacy placeholder syntax [] |
| V17 | PASS | 0 |
| V18 | PASS | 0 |
| V21 | PASS | 3329 duplicate-analysis rows reported (warning-class) |
| V22 | PASS | 2552 repeated-EN groups reported; 58 SHARED_CANDIDATE |
| V23 | PASS | 0 dup, 0 bad generated |
| V23-rev2 | PASS | 16888 rev2 keys, 0 bad, 0 unrekeyed generated |
| V23-legacy-allowlist | PASS | 11 legacy keys outside snake_case regex (allow-listed) |
| V27 | PASS |  |
| V03/V04/V05/V24/V25 | POST_IMPORT | requires created Figma variables |
| PKG-REGISTRY-MATCH | PASS | 0 collection mismatches |
| PKG-DESC-ID | PASS | 0 token descriptions not matching registry |
| MANIFEST-ROW-ACCOUNTING | PASS | 22141 source records in manifest vs 22141 non-empty records |
| MANIFEST-IDS-IN-REGISTRY | PASS |  |
| SHARED-TRACEABILITY | PASS | 431 manifest rows -> 382 shared entities |
| MANIFEST-ENTITY-COVERAGE | PASS | 0 entities without manifest rows |
| V26 | WARN | not evaluated |

## Corpus

- Source CSV files: 8 (architecture doc counted 7; `Tabungan` CSV is the 8th and was migrated)
- Source records (excl. headers): 34113 (7-file subset without Tabungan = 32886, matches the doc's 32,886)
- Empty records: 11972
- Copy-bearing source records (COPY/EXPLORATION/OBSOLETE): 21040
- Row classes (post-split, side-by-side pairs counted separately): {"CONTEXT_STUB": 259, "COPY": 20627, "EXPLORATION": 318, "INSTRUCTION_OR_REUSE_HINT": 3, "INVALID": 2, "LINK_LABEL": 12, "OBSOLETE": 187, "SECTION_HEADER": 825}
- Entities: 20602 ({"active": 17074, "archived": 3212, "draft": 316})
- Confirmed shared entities: 382, consolidating 431 source rows
- Shared-promotion groups classified SHARED_CANDIDATE: 58; contextual/ambiguous repeated strings: 2541
- Legacy key conflicts: 53 keys

## Systematic cleanup performed

- line_endings_normalized: 4 cells
- nbsp_to_space: 10 cells
- outer_whitespace_trimmed: 1810 cells
- zero_width_removed: 44 cells

## Review issue counts (review-required.csv)

- AMBIGUOUS_SHARED_CANDIDATE: 571
- INVALID_ROW: 2
- LANGUAGE_SWAP: 10
- LEGACY_KEY_CONFLICT: 57
- MALFORMED_PLACEHOLDER: 93
- MISSING_EN: 128
- MISSING_ID: 143
- PLACEHOLDER_MISMATCH: 99
- PLURAL_VARIANT: 66
- POSSIBLE_DUPLICATE: 2778
- SECTION_ONLY_CONTEXT: 4571
- SIDE_BY_SIDE_PAIR: 107
- UNCERTAIN_MULTILINE_SPLIT: 27
- UNRESOLVED_POSITIONAL_PLACEHOLDER: 310
- UNRESOLVED_ROLE: 14177
- UNTRANSLATED_LONG_EN_EQ_ID: 12

## Variables per collection (active + draft; cap 4000)

| Collection | Active | Draft | Total |
|---|---|---|---|
| insurance | 2724 | 41 | 2765 |
| transfer | 2640 | 16 | 2656 |
| payment | 1725 | 98 | 1823 |
| savings | 1423 | 14 | 1437 |
| promo | 1385 | 9 | 1394 |
| investment | 1308 | 66 | 1374 |
| home | 1340 | 22 | 1362 |
| group | 689 | 0 | 689 |
| lending | 668 | 3 | 671 |
| split-bill | 571 | 16 | 587 |
| transport | 471 | 0 | 471 |
| account-safety | 430 | 0 | 430 |
| shared | 379 | 0 | 379 |
| insurance-health-insurance-pre-ut | 327 | 13 | 340 |
| finance | 313 | 4 | 317 |
