# UX Copy Sync architecture

> **Living document.** Update this file in the same change set whenever a
> feature changes the plugin's data flow, Figma permissions, UI ↔ plugin
> message contract, matching rules, or external integrations. Update the
> “Last reviewed” date and append a short entry to the change log.

**Last reviewed:** 2026-08-13  
**Plugin version:** manifest API `1.0.0`  
**Status:** development-mode Figma plugin; no build system or automated test suite

## Purpose

UX Copy Sync transfers approved UX copy from a public Google Sheets cell link
into visible text descendants of one selected container. The linked cell is
the first candidate and later non-empty cells in its column provide following
replacement values. Every write requires an editable preview.

The plugin never edits images, creates layers, or changes any property other
than `TextNode.characters`.

## Repository map

| File | Responsibility |
| --- | --- |
| `manifest.json` | Figma metadata, entry points, editor scope, page access, and allowed Google domains. |
| `code.js` | Figma plugin sandbox. Traverses document nodes, loads fonts, applies copy, and handles UI messages. |
| `ui.html` | Self-contained UI. Parses cell URLs, loads the requested Sheet column, holds the editable preview, and renders results. |
| `README.md` | User installation and operating guide. |
| `ARCHITECTURE.md` | This technical, change-maintenance reference. |

There is intentionally no package manager, transpilation step, or external
runtime dependency: import `manifest.json` directly into Figma development
mode.

## Runtime boundaries and data flow

```text
Google Sheets Visualization callback ─────────> UI (`ui.html`): load linked column
                                               │ preview/apply postMessage
                                               v
                                    Plugin thread (`code.js`)
                                      ├─ inspect current Figma page/selection
                                      ├─ find and order text layers
                                      ├─ load every font in each target node
                                      └─ set TextNode.characters
                                               │
                                               │ figma.ui.postMessage(result)
                                               v
                                    UI: preview, result report, layer locate action
```

### Trust and permission boundary

- The UI loads a Google Visualization callback from `https://docs.google.com`.
  Script loading is used because the CSV responses omit CORS headers and
  browser `fetch` therefore fails inside Figma's null-origin iframe.
  `manifest.json` permits only `https://docs.google.com`.
- The plugin thread has Figma document access limited to the dynamically
  loaded current page (`documentAccess: "dynamic-page"`). It does not scan
  other pages.
- Imported and fetched rows are in-memory UI state only. Closing/restarting
  the plugin clears them; no credentials or source data are persisted.

## Main plugin thread (`code.js`)

### Node collection, snapshots, and scope

Exactly one Frame, Component, Instance, Group, or Section must be selected.
Visible text descendants are recursively collected and ordered by absolute Y,
then X for rows within 4 px, then ID. The plugin stores an authoritative
snapshot under a single-use preview token. Before applying, it compares IDs,
order, original strings, visibility, positions, container, and current page.

### Font-safe writes

Figma requires fonts to be loaded before changing text. For each target,
`loadFonts()` loads every font used by the node’s existing character ranges
(or its `fontName` for an empty node). A missing or unloadable font blocks the
entire reviewed apply before any write. This preserves the node’s current
style ranges as far as the Figma API permits; incoming copy only replaces
characters.

### Application

The UI derives pairs by filtering included targets then pairing replacements
in their current drag order. It sends reviewed IDs and strings only. The
plugin validates the token and snapshot, rejects concurrent reuse of an
in-flight token, resolves every pair, checks missing fonts and locked ancestry,
loads all fonts, and only then writes. A failed assignment triggers a
best-effort rollback of earlier writes.

### UI message contract

| UI → plugin | Payload / effect | Plugin → UI |
| --- | --- | --- |
| `get-selection-state` | Requests target-card summary | `selection-state` |
| `get-selection-context` | Validates selection and creates a snapshot | `selection-context-result` |
| `discard-preview` | `{ previewToken }` | Drops unused snapshot |
| `apply-reviewed-pairs` | `{ previewToken, pairs }` | `apply-reviewed-pairs-result` |
| `select-node` | `{ previewToken, layerId }` | Selects/zooms approved preview layer |
| `close` | Closes the plugin | No response |

All messages pass through `figma.ui.onmessage` in the plugin thread and
`window.onmessage` in the UI. Any new message type must be added to this table
and should have an explicit error response if it can fail.

## UI and source pipeline (`ui.html`)

### Source model

The UI retains only a pasted cell URL, parsed source metadata, preview target
state, and replacement objects. Replacement IDs derive from sheet row and
session position, allowing duplicate values to be reordered safely.

### Sheet handling

The URL must be `docs.google.com`, contain a spreadsheet ID, a single `gid`,
and a single-cell A1 `range` in either query or fragment. The UI requests the
linked column through a uniquely named Google Visualization response callback,
then removes the temporary script and callback. It slices from the requested
row, skips blank values, and preserves non-empty strings and true sheet row
numbers. No sheet request is sent through the plugin controller.

## User-visible behavior

1. The user selects one supported container and pastes a public cell link.
2. The plugin snapshots targets before the UI fetches only enough column data.
3. Preview supports target exclusion and replacement reordering; Locate is
   treated as a plugin-initiated selection change.
4. Any later relevant selection/canvas change invalidates Apply; success sends
   an in-UI state and Figma notification.

## Current constraints and technical risks

- The UI is one large HTML file with inline styles and script. Maintain clear
  section comments or split it only alongside a deliberate build/tooling plan.
- No automated tests currently protect CSV parsing, range calculation,
  ordering, or UI/plugin contract changes. Manually validate the workflow in
  a Figma test file after behavior changes.
- Reading order is based on absolute Y/X coordinates and a fixed 4 px
  threshold; multi-column layouts, overlays, or changed visibility can shift
  pairings. Preview before every sequence apply.
- Empty, multiple, and raw-text selections are deliberately rejected; the
  plugin never broadens a request to the entire page.
- Preview strings and layer names are escaped before being rendered. Keep that
  behavior if the UI is extended to display additional arbitrary copy.

## Change checklist

For every functional change, update the applicable parts of this document and
the README when user workflow changes. Before handoff, verify:

- `manifest.json` still declares every needed entry point, permission, and
  allowed network host.
- Both directions of any modified message match exactly in `code.js` and
  `ui.html`.
- Text writes still load all required fonts and report skipped nodes.
- Preview/apply are manually exercised with a small current-page Figma
  fixture, including hidden text and a missing-font case where practical.
- `ARCHITECTURE.md` has an updated review date and changelog entry.

## Architecture change log

| Date | Change |
| --- | --- |
| 2026-08-13 | Created the baseline architecture document from the current implementation. |
| 2026-08-13 | Replaced multi-source/name matching with cell-URL preview workflow, authoritative snapshots, stale detection, and atomic preflight. |
| 2026-08-13 | Hardened async refresh/stale handling, single-use apply concurrency, locked-layer preflight, and read-only stale/applied previews. |
| 2026-08-13 | Replaced the non-CORS `gviz` CSV request with the browser-accessible Sheets export endpoint. |
| 2026-08-13 | Moved Sheets download to the plugin thread after Figma UI iframe redirects remained blocked. |
| 2026-08-13 | Fixed executable fetch drift with validated `gviz` and Sheets export transports plus a timeout for orphaned UI requests. |
| 2026-08-13 | Corrected Figma network wildcard syntax, prioritized the non-redirecting transport, and surfaced endpoint diagnostics instead of misreporting every transport failure as a sharing problem. |
| 2026-08-13 | Replaced CORS-dependent Sheets downloads with a Visualization callback loaded by the UI. |
| 2026-08-13 | Fixed the invalid scheme-less manifest permission and removed the guaranteed-to-fail CORS fallback transports. |
