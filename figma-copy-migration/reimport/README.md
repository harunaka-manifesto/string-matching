# Exact-copy replacement library

Generate with `pnpm prepare:library`; verify with `pnpm test:library`. Generated JSON packs and registry files are kept locally and can be regenerated from the original tracked registry.

| Metric | Count |
| --- | ---: |
| Original active variables | 16,393 |
| Replacement active variables | 12,885 |
| Exact duplicate groups | 1,838 |
| Groups shared across products or already Shared | 480 |
| Archived duplicate IDs redirected to canonical IDs | 3,508 |
| Replacement Shared variables | 847 |

Equality uses all raw localized values. Different punctuation, whitespace, line breaks, case and translations remain separate. Whole placeholders and numeric/data-only values stay contextual. Exact duplicates within one product reuse one product key; exact copies across products use one Shared key. Existing Shared IDs win, otherwise the oldest ID wins. All discarded keys remain aliases and all IDs remain in `registry.jsonl`.

`collections/<product>/{EN,ID}.json` contains active copy only; import EN and ID into the **same collection**, with modes named exactly `EN` and `ID`. Use one product collection per folder, keeping the single group in token names. Insurance's old health partition is included in Insurance. Every generated collection stays under the 4,000-variable operational ceiling. Draft and held entries remain registry-only.

`merge-map.json` lists old names and IDs → canonical IDs/names. `merge-events.jsonl` is a new migration event segment; the original append-only ledger is untouched. `registry.jsonl` is the prepared registry snapshot for this replacement. Keep it with those events when adopting this library, rather than treating the original CSV migrator as the new authoring source. `analysis.json` records counts per collection.

Import into a duplicate library file for verification before publication. Native token import does not preserve Figma variable keys or create plugin data. Backfill Copy IDs, verify both locales, publish the replacement, and rebind design files by Copy ID/merge map before retiring the old library. Existing bindings do not migrate merely because the JSON has the same name. Until migration is complete, the updated picker works with the old library and collapses exact bilingual duplicates in its results.

For concurrent creation/editing and library publication, see [the backend plan](../../docs/string-registry-backend.md).
