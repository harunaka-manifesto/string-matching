# String Binder

String Binder is a Figma plugin that binds text layers to the string variables in
the **GoPay Strings** library. A writer selects one frame, assigns a string to
each visible text layer, and applies. Matching layers in duplicated screens on
the same page get the same strings automatically.

## How writers use it

1. Enable the GoPay Strings library in the design file (Assets › Libraries).
2. Select one frame, component or instance. The plugin lists its visible text
   layers in reading order: top to bottom, then left to right.
3. Check the **product** chip at the top. The plugin guesses it from strings
   already bound in the frame, then from frame, section and page names; if it
   can't tell, it asks on the first search. Search and prefill show only that product and `shared/…` strings. Change the
   product menu to **All products** only when deliberately searching across streams.
4. Choose the string for the first layer. Search covers EN/ID copy, full keys,
   legacy aliases, immutable Copy IDs, descriptions and screen context. Exact
   keys/IDs and full-copy matches lead; frame/component context, layer role,
   canvas text and nearby bindings refine the order. One spelling error is
   tolerated. Each result shows its key, context and match hints. Exact
   bilingual duplicates collapse into one result, preferring Shared; different
   translations remain separate. The best 20 results appear first.
   - The layers below follow the **legacy sheet order**, so a correctly anchored
     screen usually needs only a few fixes.
   - Shift a suggestion with `[` / `]` (or the arrows in the open row) to move
     the order from that row down. Picking another string restarts the order
     from that row.
5. Skip (`S`) layers that are not copy. Amounts, dates, times, phone numbers and
   status-bar or keyboard text start skipped. Flag (`F`) layers that need a
   string that doesn't exist yet. `U` unbinds. An open row shows before → after
   when apply would replace or remove an existing binding.
6. Click **Apply to frame & page** (`⌘↵`). The plugin:
   - binds the strings and renames each bound layer to the full variable name
     (e.g. `investment/gopay_investment_…_title`);
   - remembers skips and flags on each layer (shared plugin data `copy/state`);
   - applies the same bindings, names and skips to matching layers on the
     current page.

   Layers already bound to a different string keep their binding and are listed
   as conflicts. One undo reverts the whole apply.

Keyboard: `↑`/`↓` move between layers (the canvas selection follows), `↵` opens
search, `esc` closes it. "Select flagged layers on page" is in the `⋯` menu.

## How it works

- **No backend.** The first run imports every string variable in the enabled
  libraries to read its values. It shows progress while it does this, then
  stores a gzipped copy of the values in `figma.clientStorage`, per user. Later
  runs import only variables added since. **Reload strings from library** (`⋯`
  menu) reloads everything.
- **Legacy order.** The Figma collections are sorted alphabetically, and the
  `_text_N` suffixes don't follow the sheets. `scripts/build-order-index.mjs`
  rebuilds the sheet order from each `tab` and `rec` in
  `figma-copy-migration/registry/copy-registry.jsonl` into
  `apps/plugin/src/generated/order-index.ts`, together with each string's
  legacy section and screen (shown in search). Strings that the sheets never
  had follow library order.
- **Matching duplicates.** `packages/domain/src/layer-similarity.ts` scores
  candidate layers on:
  - layer path and component slot
  - position in the frame
  - text style
  - layer name
  - text
  - frame name

  A candidate matches at a score of 0.75 or more, and each duplicate frame gets
  at most one match per source layer.

## Repository map

```text
apps/plugin/          Figma plugin: controller (src/main) and React UI (src/ui)
packages/contracts/   Zod message schemas shared by controller and UI
packages/domain/      Pure logic: visibility, reading order, prefill, search, matching, non-copy rules
scripts/              Order-index generator, sandbox contract check, copy migration
figma-copy-migration/ Migration data and the copy registry
docs/                 Copy identity architecture and plugin copy rules
```

## Develop

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm build` regenerates the order index and writes the plugin to
`apps/plugin/dist`. In Figma desktop, go to Plugins › Development › Import
plugin from manifest and choose `apps/plugin/dist/manifest.json`.

`pnpm dev:ui` serves the UI in a browser with a mock bridge that uses real
legacy order data, at `/src/ui/index.html`. Add `?frame=<name>` to try another
frame name and `&fresh` to start with no bound layers (for the product prompt).

## To verify in Figma

These can only be checked in a real file that uses the library:

- How long the first import of about 16k library variables takes, and whether
  importing leaves anything visible in the file.
- Whether `getVariablesInLibraryCollectionAsync` returns variables in panel
  order. Only strings that aren't in the legacy sheets depend on this.
- Binding `characters` on text inside instances.
- Renaming text layers inside instances (it creates a name override) and how
  long the page-wide usage scan takes on large pages.

## Shared-copy migration and future editing

`pnpm prepare:library` generates product-based import packs, a preserved-ID
registry and exact merge redirects in `figma-copy-migration/reimport`.
`pnpm test:library` checks exact equality, identity, aliases and idempotency.
The original migration ledger is unchanged. See
[the import guide](figma-copy-migration/reimport/README.md) before replacing
existing variables or bindings.

The future create/edit feature will use a shared backend for versioned writes
and a sync plugin running in the library file. On the team's non-Enterprise
Figma plan, an editor still publishes the library. The complete concurrency,
identity, sync-recovery and developer-export plan is in
[docs/string-registry-backend.md](docs/string-registry-backend.md).

Future authoring uses the tested `copy-identity.ts` helpers in the domain package:
UUIDv7 Copy IDs persist across retries; normalized context determines a frozen
developer key; permanent reservations cover current keys, aliases and tombstones.
The backend plan specifies create-only transactions and revision conflicts so
concurrent writers cannot overwrite an existing identity.
