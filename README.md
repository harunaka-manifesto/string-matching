# UX Copy Sync — Figma plugin

Replace copy in one selected Figma container from a public Google Sheets cell link.

1. Select exactly one Frame, Component, Instance, Group, or Section.
2. Paste a public Google Sheets cell URL, for example `...#gid=0&range=D18`.
3. Choose **Fetch & preview**. The linked cell, then later non-empty cells in that column, are paired with visible text descendants in visual reading order.
4. Review the original and replacement copy. Exclude layers or reorder replacement values as needed.
5. Choose **Apply changes**.

The sheet must be shared as **Anyone with the link: Viewer**. Blank cells are skipped, values retain meaningful whitespace, and a short sheet updates only the available pairs.

The plugin blocks an apply if the source frame, target text, visibility, or target position changes after preview. It loads every target font before writing and uses best-effort rollback for unexpected write failures.

## Install

In Figma desktop, choose **Plugins → Development → Import plugin from manifest…**, then select `manifest.json` in this folder.

## Limits

Only the current page and visible descendants of the selected container are considered. No OAuth, private sheets, file imports, or layer-name matching are included. Figma determines style extension when replacement length differs from mixed-style source text.
