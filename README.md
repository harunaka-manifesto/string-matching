# UX Copy Sync — Figma plugin

Pulls approved UX writing copy from a spreadsheet and writes it directly into
matching text layers on the canvas, so screens and micro-components (buttons,
tooltips, error states, etc.) always reflect the writer's latest strings.

Built for sheets that are large and messy in practice: dozens of tabs,
thousands of rows, a screenshot column for reference, and — on tabs that
don't have stable per-layer keys — copy listed in the same order it appears
on the screen.

## Two matching modes

**Match by layer name** — each row's key matches a Figma text layer's exact
name (e.g. a layer named `cta.primary.label`). Reliable and safe for bulk
runs across a whole page, but requires the file's layers to already be named
consistently.

**Match by order** — for tabs where rows have no unique key, just the copy
in sequence. The plugin sorts every text layer in your current selection by
reading order (top-to-bottom, then left-to-right) and pairs row 1 → first
layer, row 2 → second layer, and so on. Because order is fragile (a layer
moved, hidden, or duplicated will shift everything after it), this mode
always shows a **preview pairing** — layer name + current text next to the
incoming copy — before anything is written, and only ever applies to your
current selection, not the whole page.

Use name-matching wherever layers are already keyed; fall back to
order-matching tab by tab, screen by screen, for the rest.

## Setting up multi-tab sources

No need to "Publish to web" anymore — each tab is fetched directly by its
own link, so adding a new tab is just pasting a URL:

1. Make sure the sheet is shared as **Anyone with the link: Viewer** (or
   more open) — the plugin fetches without an API key or OAuth.
2. Open the tab you want in the browser; copy its URL. It should look like
   `https://docs.google.com/spreadsheets/d/<ID>/edit#gid=<GID>`.
3. In the plugin, optionally name the tab, paste the URL, click **Add + fetch**.
4. Repeat for as many tabs as you need — each shows up in the tab list with
   its row count, and can be removed with the ✕.

If the sheet can't be shared even at "Anyone with the link" (e.g. it's
restricted to your org), use **Upload .csv/.tsv file(s)** instead: in Google
Sheets, `File → Download → Comma-separated values (.csv)` for each tab, then
select all the downloaded files at once in the plugin — each becomes its own
tab, named after the file. No sharing changes needed at all.

For a quick one-off test or a small manual edit, **Paste CSV instead** lets
you paste rows directly — it auto-detects whether you pasted tab-separated
data (the default when copying cells straight out of Sheets) or comma-
separated, so copy containing commas won't get cut off.

## Handling the screenshot column

The plugin never touches images — Google Sheets doesn't export inline
images through CSV in the first place, so that column just comes through
blank or is simply skipped. You tell the plugin which columns actually
matter:

- **Key column** / **Copy column** in name-mode (letters, e.g. `A` and `D`
  if the screenshot sits in `B`/`C`).
- **Copy column** only in order-mode (there's no key column to set, since
  matching is positional).
- **First row is header** toggle skips the header row regardless of column
  layout.

These settings apply to all tabs currently loaded, so keep column layout
consistent across tabs where possible.

## Installing the plugin (development mode)

1. Open the Figma desktop app.
2. Go to `Plugins → Development → Import plugin from manifest…`.
3. Select `manifest.json` from this folder.
4. Open any file, run the plugin from `Plugins → Development → UX Copy Sync`.

## Using it

**Name mode:** add tabs → set key/copy columns → choose selection or entire
page → **Apply to canvas**. Check the report for unmatched layers (usually
a naming typo) and unused rows (a key not wired to any layer yet).

**Order mode (opens by default):** add the tab that corresponds to the
screen you're working on → select that screen's frame on the canvas →
**Preview pairing for current selection** → review the table (mismatched
counts or rows/layers with no partner are flagged) → **Confirm apply**.

If a tab holds copy for many products/screens at once (common with a large
shared strings tracker), use the **Rows** From/To fields to point at just
the block of rows for the screen you're working on — row numbers count data
rows only (the header, if any, isn't row 1). The badge underneath shows how
many rows are currently selected so you can sanity-check the range before
previewing.

## Known limitations (v1)

- Scans the **current page** only (`documentAccess: dynamic-page`), to keep
  plugin permissions minimal — no cross-page sweeps yet.
- Order-mode reading-order sort assumes a roughly single-column, top-to-
  bottom layout; a multi-column screen (e.g. a grid of cards) may need the
  sheet rows pre-sorted to match, or a manual touch-up after applying.
- If a text layer mixes multiple fonts within one string, the whole layer
  is re-set using the layer's dominant font — fully mixed-style runs may
  need a manual touch-up afterward.
- Name-mode matching is exact on the trimmed layer name (case-insensitive
  by default, toggleable); no fuzzy/partial matching, by design, to avoid
  copy landing on the wrong layer.

## Extending it

- Swap the Google Sheets source for a CMS/localization tool (Phrase,
  Lokalise, Contentful) by replacing the `fetch` call in `ui.html` — the
  rest of the pipeline (rows → `applyCopy` / `applySequence`) is
  source-agnostic.
- Add locale columns (`value_en`, `value_id`, …) and swap which column
  letter is read as the "copy column" to support reviewing multiple
  languages from the same sheet and file.
