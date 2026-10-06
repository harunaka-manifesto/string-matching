# Frame copy handoff through official Figma MCP

Use the official `use_figma` tool with read access to the requested design file. Its scripting availability depends on the caller's Figma seat/tool access. Publication is optional for committed local copy. The extractor does not write to the canvas, change language modes, or contact Supabase.

Build with `pnpm build:backend`. Read `apps/backend/dist/extract.js`, remove its final `export { extractFrames };` block, and append:

```js
return await extractFrames(figma, {
  frameIds: ['99:7353'],
  fileLabel: 'GoPay Strings',
  cursor: 0,
  pageId: '25:17550', // Optional; otherwise inferred from the first frame.
});
```

Run that complete script as the code passed to `use_figma` for the supplied file link. Use colon-form node IDs. Extract frames from one page per tool call; page context is selected once and reselected on every chunk call. Combine complete per-page bundles afterward, checking identities/revisions just as for multiple files. For every following chunk, use `nextCursor` as `cursor` and pass the first response's `snapshotHash` as `expectedHash`. Keep frame IDs and file label unchanged. Stop when `nextCursor` is null. Concatenate the `chunk` strings in cursor order and parse the result as JSON. Verify the assembled string's SHA-256 equals `snapshotHash`, and that its length equals `totalCharacters`. Never discard or infer omitted records to fit a tool response.

The version 1 bundle contains frames, managed occurrences, bilingual records, unmanaged text, actionable issues, and `ready`. Each managed occurrence specifies its Copy ID, frozen developer key, applied revision, displayed locale, text node, and variable key. Each record includes the exact saved EN/ID values represented in those frames.

Alias values resolve recursively by named EN/ID modes. Missing modes, alias cycles, unpushed manual wording, unknown identities, stale occurrence snapshots, changed keys, and conflicting revisions are reported. `ready: false` blocks handoff: run String Binder in the working file or reconcile the central library, then extract again. A change while reading or between chunks requires discarding all chunks and restarting.

Save each page/file's chunk responses as a JSON array in cursor order. The assembler verifies complete cursors, lengths and SHA-256, then checks cross-page/file revisions and key ownership:

```sh
pnpm build:backend
pnpm bundle:frames file-a-chunks.json file-b-chunks.json --out handoff.json
```

Complete version-1 bundles may also be supplied as inputs. Give every extraction a unique file/page label. The combined result preserves occurrence file/frame references and reports conflicts instead of choosing a revision. A bundle with issues exits with status 1 and `ready: false`; do not pass it to development as consistent copy. It never fetches backend values to replace a frame's applied revision.

The script's pure implementation is in `apps/backend/src/mcp/extract.ts`, covered by simulated Figma tests. A read-only real MCP check ran on GoPay Strings / WithdrawPage/default (`99:7353`, page `25:17550`) across three consistent chunks. Its legacy bound occurrences correctly report missing committed revision metadata and `ready: false`. Successful committed-copy handoff and developer-seat access remain pilot checks after deployment and library reconciliation. Official capability reference: [Figma write-to-canvas tools](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/).
