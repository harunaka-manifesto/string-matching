# Testing and release checks

Automated checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:ui
pnpm build
```

Unit tests cover URL parsing, blank scans, 500-row bounds, source fingerprints,
normalization, visibility and clipping, visual order, pairing/insert reorder,
duplicate cards, Workspace domain policy, OAuth poll consumption, retry/error
mapping, route registration, and Apply preflight/rollback behavior.

The Playwright harness runs the real React UI against a development-only mock
bridge. Its fixture includes authenticated state, six targets, duplicate/long
copy support, reorder controls, and Apply/success states. Production bundling
tree-shakes the mock bridge and emits a self-contained Figma UI.

Manual Figma QA should use fixtures for a vertical form, same-row actions,
hidden/transparent/partially clipped text, an Instance, mixed styles, locked
layers, missing fonts, stale preview, injected rollback failure, already-synced
names, and separate undo steps. Authentication must be exercised in desktop
and browser with account rejection, reconnect, restart, logout, revoked
consent, callback replay, and public-test flag on/off. Private and public Sheet
fixtures should include interior blanks, formula-empty cells, line breaks,
permission errors, and a source edit after preview.
