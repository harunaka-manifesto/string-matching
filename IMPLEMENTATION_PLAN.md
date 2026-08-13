# UX Copy Sync — Cell URL Workflow Implementation Plan

**Status:** Approved product plan, ready for implementation  
**Last updated:** 2026-08-13  
**Primary goal:** Replace copy inside one selected Figma container using consecutive non-empty Google Sheets cells, beginning at a pasted cell URL, with an editable preview before any canvas write.

## 1. Intended user experience

The finished plugin has one focused workflow:

1. The user selects exactly one supported container in Figma.
2. The user pastes a public Google Sheets URL pointing to one cell, such as `https://docs.google.com/spreadsheets/d/<ID>/edit#gid=123&range=D18`.
3. The user presses **Fetch & preview**.
4. The plugin counts visible text descendants in the selected container and orders them top-to-bottom, then left-to-right when they share a row.
5. The plugin reads the linked cell as replacement #1 and continues downward in the same column until it has one non-empty replacement per visible text layer or reaches the end of the sheet.
6. The preview shows every target layer's original string beside its proposed replacement.
7. The user may exclude target layers from replacement and drag replacement strings into a better order.
8. The user presses **Apply changes**. The plugin validates that the reviewed canvas state is still current, loads all fonts, and writes each replacement to its exact reviewed layer once.

There is no automatic write after paste or fetch. Preview is always required.

## 2. Product decisions and scope

### Included in this version

- Public Google Sheets shared as **Anyone with the link: Viewer**.
- Standard Google Sheets cell links containing a spreadsheet ID, `gid`, and a single A1 cell reference.
- One selected Frame, Component, Instance, Group, or Section.
- Recursive visible text-layer discovery.
- Editable preview with layer inclusion controls and replacement drag-and-drop.
- Partial application when the sheet contains fewer replacements than targets.
- Atomic preflight: no writes when a target or required font fails validation.
- Stale-preview detection after relevant canvas changes.
- In-memory state only.

### Explicitly removed or out of scope

- Match-by-layer-name mode.
- Whole-tab configuration and manual row ranges.
- CSV/TSV upload and pasted CSV.
- Private-sheet authentication or OAuth.
- Multiple selected roots or whole-page fallback.
- Editing actual Figma layer visibility from the plugin.
- Creating, cloning, or deleting Figma layers.
- Cross-page scanning.
- Persistence of URLs or preview state after the plugin closes.

## 3. Interface direction

The UI should feel like a compact Figma tool, not an unstyled form. Use a clear three-step hierarchy, strong pairing rows, restrained surfaces, and a sticky action footer. Resize the plugin UI from `440 × 680` to approximately `520 × 720`; keep the content usable down to the existing width if Figma restores an older size.

### Primary screen wireframe

```text
┌──────────────────────────────────────────────────────┐
│  UX Copy Sync                                ● Ready │
│  Replace selected frame copy from a Sheet cell       │
├──────────────────────────────────────────────────────┤
│                                                      │
│  1  TARGET FRAME                                     │
│  ┌────────────────────────────────────────────────┐  │
│  │ ◇ Checkout / Payment              10 text slots│  │
│  │   Frame · visible descendants only             │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  2  GOOGLE SHEETS STARTING CELL                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ 🔗 docs.google.com/...#gid=0&range=D18         │  │
│  └────────────────────────────────────────────────┘  │
│  Public viewer link · D18 will become copy #1        │
│                                    [ Fetch & preview ]│
│                                                      │
│  3  REVIEW PAIRING                    9 used · 1 off  │
│  ┌────────────────────────────────────────────────┐  │
│  │ ⠿  01  ☑  Order title                  locate ↗│  │
│  │         ORIGINAL                               │  │
│  │         Review your order                      │  │
│  │         REPLACEMENT                            │  │
│  │         Check your order before paying         │  │
│  ├────────────────────────────────────────────────┤  │
│  │ ⠿  02  ☐  Helper text                 locate ↗│  │
│  │         ORIGINAL: We won't charge you yet      │  │
│  │         Excluded — later copy shifts down      │  │
│  ├────────────────────────────────────────────────┤  │
│  │ ⠿  03  ☑  Primary button              locate ↗│  │
│  │         ORIGINAL: Pay                          │  │
│  │         REPLACEMENT: Continue to payment       │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  UNUSED REPLACEMENTS (1)                             │
│  ┌────────────────────────────────────────────────┐  │
│  │ ⠿  “Payment complete”                         │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
├──────────────────────────────────────────────────────┤
│  9 layers will change              [ Apply changes ] │
└──────────────────────────────────────────────────────┘
```

### Visual language

- Use the existing platform font stack: Inter / `-apple-system` / Helvetica.
- Use a neutral canvas, white/elevated cards, 8 px radii, 1 px neutral borders, and the existing Figma blue for primary actions.
- Use spacing consistently: 4 px inside compact metadata, 8 px between related controls, 12–16 px between sections.
- Use labels rather than decorative icons where an icon's meaning is ambiguous.
- Show step numbers as small solid circles so the workflow is scannable.
- Render original copy in muted neutral text and replacement copy with stronger contrast and a subtle blue-tinted background.
- Make the preview list the dominant scroll region. Keep the header/source controls above it and the apply summary/action sticky at the bottom.
- Provide visible keyboard focus rings, sufficient contrast, native buttons, and descriptive `aria-label` text for drag handles, toggles, and locate actions.

### Preview row behavior

- The checkbox controls whether the **target layer** participates. It does not change `node.visible`.
- An included row displays original and replacement strings, including explicit `(empty text)` when the original string is empty.
- An excluded row remains in its original target position, becomes visually muted, and shows “Excluded — later copy shifts down.”
- Dragging moves only replacement values. The layer order and original-copy column never move.
- Use a dedicated drag handle. Do not make the whole row draggable because text selection and the Locate control must remain usable.
- While dragging, show a clear insertion line and a lifted dragged card. Support keyboard reordering with **Move up** and **Move down** controls available through an overflow/menu or accessible buttons.
- A Locate action sends the layer ID to the plugin thread, selects the node, and zooms it into view. This selection change must not immediately destroy the preview; the plugin must distinguish its own locate action from an external selection change. Apply still validates the original container ID.
- Replacement values without a participating target appear under **Unused replacements** and remain draggable back into the active replacement sequence.
- Targets without available replacement values show **No sheet value — unchanged** and do not count toward the apply total.

### UI states

#### Empty or invalid selection

```text
┌─ 1 TARGET FRAME ────────────────────────────────────┐
│  Select one frame, component, instance, group,      │
│  or section in Figma to continue.                   │
└─────────────────────────────────────────────────────┘
```

Disable **Fetch & preview** until both the selection and URL are valid. Never silently use the entire page.

#### Loading

- Keep the target summary visible.
- Replace the fetch button label with **Fetching sheet…** and a small spinner.
- Disable URL editing and repeated fetch actions until the request completes.
- Do not clear a valid old preview until the new request succeeds; visually mark it as stale while loading.

#### Restricted or invalid sheet

- Present an inline error directly below the URL field.
- For HTTP/auth/HTML responses: “This sheet could not be read. Share it as ‘Anyone with the link: Viewer’ and try again.”
- For an invalid URL: identify the missing component, e.g. “Paste a Google Sheets link to one cell; the URL must include `gid` and `range=D18`. ”
- Preserve the pasted URL so the user can fix it.

#### Stale preview

```text
┌─────────────────────────────────────────────────────┐
│ ⚠ The frame changed after this preview was built.   │
│ Review a fresh pairing before applying.             │
│                                  [ Refresh preview ] │
└─────────────────────────────────────────────────────┘
```

Disable Apply. Preserve the old preview as read-only until refreshed so the user understands what was invalidated.

#### Success

- Show “Updated N text layers” in the sticky footer and through `figma.notify`.
- Disable Apply immediately after success.
- Keep the applied preview visible with a **Applied** status and a **Build new preview** action.

## 4. Detailed implementation approach

### 4.1 Simplify the UI state model

Replace the current multi-tab and mode state in `ui.html` with:

```js
{
  phase: "idle" | "loading" | "ready" | "stale" | "applying" | "applied" | "error",
  cellUrl: "",
  source: null | {
    spreadsheetId: string,
    gid: string,
    columnLabel: string,
    columnIndex: number,
    startRow: number
  },
  selection: null | {
    containerId: string,
    containerName: string,
    containerType: string,
    visibleTextCount: number
  },
  previewToken: null | string,
  targets: Array<{
    layerId: string,
    layerName: string,
    originalText: string,
    included: boolean
  }>,
  replacements: Array<{
    replacementId: string,
    value: string,
    sheetRow: number
  }>
}
```

`replacementId` must be stable during reordering; use a deterministic session value such as `<sheet-row>:<array-index>`. Do not use replacement text as identity because duplicate strings are valid.

The derived pairing is calculated in the UI, in this order:

1. Filter target rows where `included === true`.
2. Keep replacements in the user's current drag order.
3. Pair by index up to the shorter array length.
4. Mark remaining targets as unchanged and remaining replacements as unused.

Any inclusion or drag action recomputes the display and apply count without fetching or rescanning.

### 4.2 Parse and fetch the linked column

Create a dedicated URL parser with no fallback to `A1` or `gid=0`:

- Require hostname `docs.google.com`.
- Require path matching `/spreadsheets/d/<spreadsheet-id>/...`.
- Read `gid` and `range` from either the query string or URL fragment because Google emits both shapes.
- Accept case-insensitive single-cell A1 references with optional `$`, such as `D18`, `$D$18`, or percent-encoded equivalents.
- Reject multi-cell ranges such as `D18:D30`, named ranges, whole-column ranges, and links without a cell.
- Normalize the column to uppercase and the row to a positive 1-based integer.
- Support multi-letter columns (`AA`, `ZZ`) through the existing base-26 column conversion.

Fetch the tab through:

```text
https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&gid=<GID>
```

Parse it using the existing quote-aware CSV parser, then inspect only the linked column beginning at `startRow - 1`.

Blank-cell rule:

- Skip missing cells and values for which `value.trim() === ""`.
- Preserve the exact original value of non-empty cells, including meaningful leading/trailing whitespace; trimming is only for the blank check.
- Continue to the end of the CSV until enough non-empty replacements exist for the initial visible target count.
- Record the real 1-based sheet row for every replacement so the UI can label it, e.g. `D21`.
- If no non-empty values exist from the starting cell downward, show an error and do not create a preview.

### 4.3 Discover and order target layers

In `code.js`, replace scope fallback logic with strict selection validation:

- Selection length must equal one.
- Selected node type must be `FRAME`, `COMPONENT`, `INSTANCE`, `GROUP`, or `SECTION`.
- Walk descendants recursively.
- A text node participates only if it and every traversed ancestor have `visible !== false`.
- Do not reject locked targets during discovery; validate writability during preflight and show an actionable error if Figma prevents the write.
- Include empty text nodes.
- Do not include the selected node itself unless it could be a supported container; raw TEXT selection is invalid by design.

Sort a copied array of targets by:

1. Absolute bounding-box Y ascending.
2. When `abs(aY - bY) <= 4`, absolute bounding-box X ascending.
3. When coordinates are equal, node ID ascending as a deterministic tie-breaker.

Snapshot each target with:

```js
{
  id,
  name,
  characters,
  visible,
  absoluteX,
  absoluteY,
  hasMissingFont
}
```

The plugin thread owns the authoritative snapshot and saves it in memory under an unpredictable `previewToken`. The UI receives only the token and fields required for display. Tokens expire when replaced by a newer preview or after a successful apply.

### 4.4 Preview creation sequence

Use this exact sequence to avoid fetching the wrong amount of sheet data:

1. UI validates URL syntax locally.
2. UI requests `get-selection-context`.
3. Plugin validates selection, discovers/outputs ordered visible targets, stores the authoritative snapshot, and returns `previewToken` plus display metadata.
4. UI fetches and parses the Google Sheet using the returned target count.
5. UI creates its editable inclusion/replacement model.
6. If the fetch fails, UI calls `discard-preview` with the token so the plugin can drop the unused snapshot.

The preview reflects the canvas at step 3. Before Apply, the plugin re-runs discovery and compares against the stored snapshot.

### 4.5 Drag-and-drop and inclusion semantics

- Use native HTML Drag and Drop if it behaves reliably inside the Figma iframe; isolate it behind small `dragstart`, `dragover`, `drop`, and `dragend` functions.
- Also implement button/keyboard reordering so the workflow is not mouse-only and remains usable if native dragging is inconsistent on a platform.
- Reorder the `replacements` array, not DOM nodes directly. Re-render from state after every move.
- Keep all fetched replacements in the array even when there are fewer included targets; the overflow is rendered as unused.
- Excluding a target reduces the number of active pairings. Example: 10 targets and 10 replacements becomes 9 applied pairs plus 1 unused replacement.
- Re-including the target restores the next available replacement automatically.
- Exclusion is allowed even when there is a sheet shortage.
- Excluded layers and unpaired layers remain unchanged during Apply.

### 4.6 Stale-preview detection

Listen for `figma.on("selectionchange")` and notify the UI when the selection no longer equals the preview container. A Locate action temporarily selects a child node, so it must carry an intent flag:

- Before `select-node`, record that the next selection change is plugin-initiated.
- Ignore that one selection event for UI invalidation.
- Keep the original container ID as the required apply context even while the located child is selected.
- Any later external selection change marks the UI preview stale.

Apply must still perform authoritative validation regardless of UI status. Re-discover visible text descendants from the stored container and reject the apply if any of these differ from the snapshot:

- Container no longer exists or is no longer on the current page.
- Current page differs from the preview page.
- Visible text-layer ID set or sorted order changed.
- Any target visibility path changed.
- Any target original `characters` changed.
- Any target absolute X or Y changed by more than a small float tolerance (use `0.01`) so rearranged layers require review.

Renaming a target layer alone does not change pairing and should not invalidate Apply; IDs are authoritative. A name change may be reflected only after refreshing.

### 4.7 Apply contract and atomicity

The UI sends only final intent:

```js
{
  previewToken: string,
  pairs: Array<{
    layerId: string,
    replacementId: string,
    value: string
  }>
}
```

The plugin validates:

- The token exists, is the newest active preview, and has not been applied.
- Every `layerId` exists in the stored target snapshot and occurs no more than once.
- Every pair value is a string.
- Pair count does not exceed stored target count.
- Current canvas state still matches the stored snapshot.

Preflight every target before writing:

1. Resolve all nodes by ID and confirm each is still a `TEXT` node.
2. Reject nodes with `hasMissingFont`.
3. Load all font names used by every target.
4. Retain original characters for rollback.

Only after all paired targets pass preflight, assign `node.characters` in pair order. If an unexpected assignment fails:

- Attempt to restore every node already written using the saved original text.
- Return a failure containing the original write error and whether rollback fully succeeded.
- Never continue applying later pairs after the first failure.

After success:

- Mark and remove the active token so the same preview cannot apply twice.
- Return applied count and layer IDs.
- Notify “Updated N text layers.”

Figma groups the plugin run into its normal undo history; do not call undocumented transaction APIs.

## 5. UI ↔ plugin message contract

| Direction | Type | Payload | Response / behavior |
| --- | --- | --- | --- |
| UI → plugin | `get-selection-context` | none | `selection-context-result` with validity/error, container metadata, target display fields, and `previewToken` |
| UI → plugin | `discard-preview` | `{ previewToken }` | Deletes the token if it is active; no canvas effect |
| UI → plugin | `select-node` | `{ previewToken, layerId }` | Selects/zooms only when the layer belongs to that preview |
| UI → plugin | `apply-reviewed-pairs` | `{ previewToken, pairs }` | `apply-reviewed-pairs-result` with success count or structured error |
| Plugin → UI | `selection-state` | Current selection validity and summary | Refreshes the target card before preview; invalidates when appropriate |
| Plugin → UI | `preview-stale` | `{ previewToken, reason }` | Makes existing preview read-only and disables Apply |

Use structured error codes in addition to display messages:

- `INVALID_SELECTION`
- `UNSUPPORTED_SELECTION`
- `INVALID_CELL_URL`
- `SHEET_UNAVAILABLE`
- `NO_SOURCE_VALUES`
- `PREVIEW_NOT_FOUND`
- `PREVIEW_ALREADY_APPLIED`
- `PREVIEW_STALE`
- `MISSING_FONT`
- `FONT_LOAD_FAILED`
- `WRITE_FAILED`
- `ROLLBACK_FAILED`

The UI maps codes to concise user-facing copy and may include affected layer names where available.

## 6. Edge cases and required behavior

### Google Sheets and CSV

- **Fragment/query variants:** accept `#gid=0&range=D18` and `?gid=0&range=D18`; parse both safely.
- **Encoded range:** decode percent-encoded `$D$18` before validation.
- **Duplicate parameters:** reject conflicting `gid` or `range` values rather than guessing.
- **HTML login response:** detect HTML even when the HTTP status is 200 and show the sharing error.
- **Quoted multiline cell:** keep embedded newlines in a replacement string.
- **Comma and quote content:** preserve copy such as `Hello, “Rina”` through CSV parsing.
- **Blank selected cell:** skip it and make the first non-empty cell below replacement #1.
- **Intermittent blanks:** skip them while preserving each replacement's true sheet row label.
- **Short column:** preview and allow the available pairs; remaining targets stay unchanged.
- **Extra column values:** fetch only enough non-empty values for the initial target count; values farther below are irrelevant.
- **Duplicate values:** retain as distinct replacement items with distinct IDs.
- **Very long strings:** wrap in preview, cap visual preview height, and provide the full value via accessible text/title without truncating the applied value.
- **Formula cells:** use the displayed CSV result, not the formula source.
- **Inline images/errors:** treat empty exports as blank; visible error strings exported by Sheets are ordinary copy and appear in preview.

### Figma document

- **No selection or multi-selection:** block preview with a specific selection instruction.
- **Raw text selection:** invalid; require its container.
- **Nested hidden ancestor:** exclude all descendant text even if a child has `visible === true`.
- **Empty text:** include it as a slot and show `(empty text)`.
- **Multiple fonts:** load all range font names before writing.
- **Missing font:** block the entire apply and name every affected paired layer.
- **Mixed styles and longer/shorter copy:** replace characters only; do not intentionally normalize font, fill, size, alignment, or other node properties. Document that Figma determines style extension behavior for changed string lengths.
- **Component instances:** attempt normal text override writes supported by Figma; if the instance state rejects a write, preflight/apply returns a clear failure without partial completion.
- **Locked nodes/ancestors:** discovery includes them; actual inability to write is reported during preflight/apply.
- **Deleted layer:** stale preview; block Apply.
- **Moved layer:** stale preview when X/Y differs beyond tolerance; block Apply.
- **Visibility changed on canvas:** stale preview; block Apply and require refresh.
- **Original text edited:** stale preview; block Apply so user never overwrites unreviewed copy.
- **Layer renamed only:** permit Apply because the exact layer ID and original text remain valid.
- **Two layers at identical coordinates:** use ID as deterministic final ordering.
- **Layer outside selected frame bounds:** include it if it is a visible descendant; descendant relationship, not clipping, defines scope.
- **Located child remains selected:** Apply may proceed against the stored container after the plugin-initiated Locate action, provided canvas validation passes.

### Preview editing and application

- **Exclude all targets:** Apply count becomes zero and Apply is disabled.
- **No replacements:** do not create an actionable preview.
- **More targets than replacements:** allow partial apply; no implicit blank writes.
- **More replacements after exclusions:** show overflow as unused and allow Apply.
- **Drag a duplicate string:** move by `replacementId`, never by string comparison.
- **Apply double-click:** immediately enter `applying`, disable the button, and reject reused tokens in the plugin thread.
- **Close during fetch/apply:** no persistence; allow the current operation to terminate with the plugin. Canvas writes occur only during Apply.
- **Network changes after preview:** irrelevant; Apply uses reviewed in-memory values and does not refetch.
- **Sheet changes after preview:** Apply uses the reviewed snapshot. The user must explicitly fetch again to see later sheet edits.

## 7. Testing strategy

The current repository has no test harness. Add a minimal zero-dependency Node test setup only if logic is extracted into reusable `.js` modules that can run both in tests and the inline/plugin environment. If retaining the build-free two-file architecture makes imports impractical, create a small test HTML/Node harness for pure helpers and keep mandatory Figma verification manual. Do not introduce a bundler solely for this feature.

### Unit-level tests

Test pure functions with table-driven cases:

- URL parser: valid query/fragment links, `$` references, encoded references, multi-letter columns, wrong hosts, absent/conflicting parameters, ranges, named ranges, zero/negative/missing rows.
- CSV parser: commas, escaped quotes, multiline values, CRLF, blank rows, malformed mid-field quotes, and trailing empty cells.
- Source extraction: selected-cell inclusion, blank skipping, real row labels, exact target limit, shortage, duplicate/whitespace/multiline values.
- Reading-order comparator: Y ordering, 4 px same-row boundary, X ordering, identical coordinates, negative canvas coordinates, missing bounding boxes fallback if retained.
- Pair derivation: exclusions in first/middle/last positions, all excluded, shortages, unused overflow, duplicate replacement IDs, and drag reorder.
- Snapshot comparison: ID/order, visibility, original text, position tolerance, rename-only change, deleted/added nodes.
- Apply payload validation: unknown/duplicate layer IDs, reused/missing token, excessive pairs, and non-string values.

### Manual Figma scenarios

Create a dedicated test page with a frame containing at least 10 text layers, including nested groups, two same-row labels, one empty text node, one hidden subtree, and mixed-font copy.

1. **Happy path:** link `D18`, fetch 10 non-empty values, review, apply, and confirm exact layer/value mapping.
2. **Initial order:** confirm top-to-bottom and same-row left-to-right ordering against canvas coordinates.
3. **Exclude shift:** exclude target #3; confirm former replacement #4 moves to the next participating target and one value becomes unused.
4. **Drag reorder:** move the final replacement to the first position; apply and verify the reviewed order exactly.
5. **Short source:** provide 6 values for 10 targets; confirm only 6 layers update and 4 remain untouched.
6. **Hidden canvas layer:** hide a text layer before preview; confirm it is not counted. Toggle visibility after preview and confirm Apply is blocked as stale.
7. **Moved layer:** move a target after preview and confirm Apply is blocked.
8. **Edited original:** edit one target on canvas after preview and confirm Apply is blocked.
9. **Locate behavior:** click Locate for several rows; confirm selection/zoom works and the preview remains actionable.
10. **Missing font:** include an unavailable-font layer in a pair and confirm zero layers change.
11. **Mixed fonts:** apply to a mixed-font node and verify the plugin does not throw and Figma's resulting styles are acceptable.
12. **Restricted sheet:** use a private link and confirm the sharing instruction appears without losing the URL.
13. **Long/multiline copy:** confirm the preview remains usable and the full string is applied.
14. **Double apply:** double-click Apply and confirm one operation occurs and the token cannot be reused.
15. **Rollback simulation:** temporarily force a later assignment to throw in development; confirm earlier writes are restored and rollback status is reported.

### UI and accessibility verification

- Verify the layout at 440 px and 520 px widths and at the intended 720 px height.
- Confirm header and sticky action footer remain visible while preview rows scroll.
- Navigate URL input, fetch, include toggles, reorder controls, Locate, and Apply using only the keyboard.
- Confirm focus indicators, labels, status announcements (`aria-live`), and disabled/loading states are perceivable.
- Verify long layer names and strings wrap without pushing primary actions off-screen.
- Check light-theme appearance in Figma on macOS and Windows where available.

## 8. Acceptance criteria

Implementation is complete only when all of the following are true:

- A user can select one supported container, paste a valid public cell URL, and get a reviewed pairing without configuring columns or row counts.
- The linked cell is the first candidate; blank cells are skipped; scanning stops after collecting the initial visible target count or reaching the sheet end.
- Hidden text descendants are not counted.
- Preview clearly displays layer name, original string, and replacement string.
- Excluding a layer shifts later copy and never modifies actual visibility.
- Replacement strings can be reordered without changing target order.
- Apply uses frozen layer IDs and the exact reviewed replacement order, not a new sort.
- Sheet shortages apply available values only; unpaired layers remain unchanged.
- Relevant canvas changes make the preview stale and prevent applying.
- Font/target preflight prevents known partial writes, and unexpected failures trigger best-effort rollback.
- Successful previews cannot be applied twice.
- The UI follows the wireframe hierarchy and remains polished and usable at Figma plugin dimensions.
- `README.md` describes only the new workflow.
- `ARCHITECTURE.md` is updated in the same implementation change with the new data flow, message contract, constraints, review date, and changelog entry.

## 9. Recommended implementation order

1. Extract/replace URL parsing, selection validation, visible text discovery, and deterministic ordering.
2. Implement authoritative preview snapshots/tokens and structured UI message responses in `code.js`.
3. Replace the existing `ui.html` interface and state with the three-step workflow and source fetch/extraction.
4. Add inclusion controls, derived pairing, unused/shortage display, and accessible replacement reordering.
5. Implement stale detection, preflight, single-use apply, and rollback behavior.
6. Add automated pure-logic coverage where feasible, then execute every manual Figma scenario.
7. Update README and the living architecture document only after the implemented behavior and final message contract are verified.

