# String Binder

String Binder is a Figma plugin that binds text layers to the string variables in
the **GoPay Strings** library. A writer selects one frame, assigns a string to
each visible text layer, and applies. Matching layers in duplicated screens on
the same page get the same strings automatically.

## Authoring and registry

The plugin opens with Apply existing copies and Create new copies. Create scans a selected frame, lets writers keep or select text, enter both EN/ID, review provisional keys and occurrence targets, then save and bind local variables immediately. Editing an existing identity is global; a variant creates a separate identity. Library sync reviews Push/Pull conflicts and verifies manual Figma publication. Developers extract exact frame revisions through the official MCP script.

Remote Supabase setup is pending; follow the step-by-step [setup guide](docs/supabase-setup.md). See also the [implementation specification](docs/string-registry-backend.md) and [developer handoff](docs/developer-handoff.md). `pnpm dev:ui` provides an authentication-free mock at `http://127.0.0.1:5173/src/ui/index.html`. It never writes real Figma/Supabase data. `pnpm test:ui` checks the browser journeys.

The bootstrap dry run is clean: 62 historical keys claimed by more than one identity are resolved in `figma-copy-migration/registry/key-ownership-resolutions.json` (rules and counts in the [setup guide](docs/supabase-setup.md#key-ownership)). No IDs were created or removed.

## Applying existing copy

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
6. Click **Apply to frame & page** (`⌘↵`), review matching targets, then Confirm Apply. The plugin:
   - binds saved identities and renames managed layers to their frozen developer
     keys; legacy variables retain their existing full variable names;
   - remembers skips and flags on each layer (shared plugin data `copy/state`);
   - applies the same bindings, names and skips to matching layers on the
     current page.

   Layers already bound to a different string keep their binding and are listed
   as conflicts. One undo reverts the whole apply.

Keyboard: `↑`/`↓` move between layers (the canvas selection follows), `↵` opens
search, `esc` closes it. "Select flagged layers on page" is in the `⋯` menu.

## How it works

- **Catalog and Figma cache.** Supabase provides current saved records and ordered revision deltas. The first Figma run also imports string variables in the enabled
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

The authoring implementation uses UUIDv7 Copy IDs persisted across retries,
frozen developer keys, permanent reservations, atomic Supabase writes, and
revision conflicts. Library changes are reviewed through Push/Pull; an editor
publishes through Figma and the plugin verifies the exact manifest afterward.
See [the architecture](docs/string-registry-backend.md) for recovery rules and
[deployment setup](docs/supabase-setup.md) for the remaining pilot steps.
