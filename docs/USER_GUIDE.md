# UX Copy Sync

UX Copy Sync brings approved UX copy from Google Sheets into the text layers of
one selected Figma design. You review every assignment before anything changes.

## Before you start

- Connect the company Google Workspace account in the plugin.
- Make sure that account can open the private Sheet.
- Select exactly one Frame, Component, or Instance in Figma.
- Copy a link to the first Sheet cell that should become copy number one. The
  link must include one `gid` and one single-cell range such as `D18`.

## How to use it

1. Select the design. The plugin shows the number of visible text layers it
   found.
2. Paste the link to the first approved Sheet cell and choose **Fetch copy**.
3. Review the pairing. Figma layers stay in their visual order; Sheet-copy
   cards are the items you can move.
4. Drag a Sheet card, use its Move up/Move down buttons, or use the keyboard
   controls. Choose **Skip this layer** when a visible layer should not receive
   Sheet copy. Choose **Include again** to restore it.
5. Choose **Apply changes** after the review is correct.

Blank cells are skipped, so they do not consume a Figma layer. If the Sheet has
fewer non-empty values than the design has visible text, the remaining layers
stay unchanged. Extra values created by skipped layers appear under
**Unassigned Sheet copy** and are not written.

## How matching works

The plugin looks only below the selected design. It includes text that is
visible, has visible copy, has non-zero effective opacity, and intersects the
design's visible bounds and clipping ancestors. Partially visible text counts.
The order is top to bottom, then left to right for layers on the same visual
row. Each destination keeps its number while the Sheet strings move.

Duplicate Sheet strings are valid and are tracked by their cell identity. You
cannot edit Sheet text in the plugin; refresh the Sheet itself and fetch again
when copy changes.

## What Apply changes

For each changed active pair, Apply updates both the text content and the Figma
text-layer name. The layer name is the exact copy with line breaks replaced by
spaces, repeated whitespace collapsed, and surrounding whitespace trimmed.
The copy itself keeps its line breaks and meaningful whitespace.

Mixed inline styling is supported, but replacing the text may simplify the new
copy to one style derived from the original first character. Hyperlinks and
range-level emphasis are not semantically remapped; restyle manually if needed.

## If something changed

The plugin checks both sides immediately before writing:

- If the design changed, it marks the review stale.
- If the Sheet's ordered non-empty source changed, it marks the source stale.
- If the link was edited after Fetch, the review is marked dirty.

In each case, choose Fetch copy again, review the new pairing, and then Apply.
The plugin never silently retargets a later Figma selection.

## Troubleshooting

- **Wrong account:** disconnect and sign in with the approved Workspace account.
- **No Sheet access:** open the Sheet in Google and ask for access, then fetch
  again. Private Sheets do not need public sharing in normal mode.
- **Locked layers:** unlock the active target or an ancestor. Apply is atomic,
  so no target is changed while a lock blocks the review.
- **Missing fonts:** make the required fonts available in Figma and refresh.
- **Test mode:** development builds may offer Public Sheet test mode. It works
  only with an Anyone-with-the-link Viewer Sheet, shows a persistent banner,
  and is never available in production.
