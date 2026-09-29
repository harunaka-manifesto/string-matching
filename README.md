# String Binder

String Binder is a Figma plugin that binds text layers to the string variables in
the **GoPay Strings** library. A writer selects one frame, assigns a string to
each visible text layer, and applies. Matching layers in duplicated screens on
the same page get the same strings automatically.

## How writers use it

1. Enable the GoPay Strings library in the design file (Assets › Libraries).
2. Select one frame, component or instance. The plugin lists its visible text
   layers in reading order: top to bottom, then left to right.
3. Choose the string for the first layer. Search works like the variables
   panel: every word must appear in the name, EN value or ID value.
   - The layers below follow the **legacy sheet order**, so a correctly anchored
     screen usually needs only a few fixes.
   - Use ↑/↓ on a row to shift the order from that row down, or pick another
     string, which restarts the order from that row.
4. Uncheck layers that are not copy. Amounts, dates, times, phone numbers and
   status-bar or keyboard text start unchecked. Flag (⚑) layers that need a
   string that doesn't exist yet.
5. Click **Apply**. The plugin:
   - binds the strings;
   - remembers skips and flags on each layer (shared plugin data `copy/state`);
   - applies the same bindings and skips to matching layers on the current
     page.

   Layers already bound to a different string keep their binding and are listed
   as conflicts. One undo reverts the whole apply.

"Select flagged" selects every layer on the page flagged as needing a new
string.

## How it works

- **No backend.** The first run imports every string variable in the enabled
  libraries to read its values. It shows progress while it does this, then
  stores a gzipped copy of the values in `figma.clientStorage`, per user. Later
  runs import only variables added since. **Refresh** reloads everything.
- **Legacy order.** The Figma collections are sorted alphabetically, and the
  `_text_N` suffixes don't follow the sheets. `scripts/build-order-index.mjs`
  rebuilds the sheet order from each `tab` and `rec` in
  `figma-copy-migration/registry/copy-registry.jsonl` into
  `apps/plugin/src/generated/order-index.ts`. Strings that the sheets never
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
legacy order data, at `/src/ui/index.html`.

## To verify in Figma

These can only be checked in a real file that uses the library:

- How long the first import of about 16k library variables takes, and whether
  importing leaves anything visible in the file.
- Whether `getVariablesInLibraryCollectionAsync` returns variables in panel
  order. Only strings that aren't in the legacy sheets depend on this.
- Binding `characters` on text inside instances.
