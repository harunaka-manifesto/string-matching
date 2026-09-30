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
   can't tell, it asks on the first search. Search ranks that product's strings
   (and `shared/…` strings) first, and prefill never leaves it. **All products**
   in the search panel widens a single search.
4. Choose the string for the first layer. Results are ranked: exact EN/ID
   matches, then values that start with the query, then word matches, then
   key-name matches. Strings already bound on the page get a boost. Each result
   shows its legacy screen, so identical values like "Got it" can be told apart.
   - The layers below follow the **legacy sheet order**, so a correctly anchored
     screen usually needs only a few fixes.
   - Shift a suggestion with `[` / `]` (or the arrows in the open row) to move
     the order from that row down. Picking another string restarts the order
     from that row.
5. Skip (`S`) layers that are not copy. Amounts, dates, times, phone numbers and
   status-bar or keyboard text start skipped. Flag (`F`) layers that need a
   string that doesn't exist yet. `U` unbinds. An open row shows before → after
   when apply would replace or remove an existing binding.
6. Click **Apply** (`⌘↵`). The plugin:
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
