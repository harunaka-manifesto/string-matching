# UX Copy Sync architecture

**Last reviewed:** 2026-08-21 · **Version:** 2.2.0

## System boundary

```text
React UI ──typed postMessage──> Figma controller ──HTTPS──> Cloud Run backend
  │                             │                         ├─ Google OAuth
  │                             ├─ clientStorage: opaque  ├─ Firestore sessions
  │                             │  app session only       ├─ KMS refresh-token encryption
  │                             ├─ current-page discovery  └─ Sheets API / public QA provider
  │                             └─ atomic Figma apply
```

The UI never sees Google access/refresh tokens or the opaque backend session.
The controller owns backend requests and stores the opaque session only in
`figma.clientStorage`. Sheet strings remain in memory for the preview and are
never logged or persisted by the backend.

## Code ownership

- `packages/contracts`: Zod-validated network and plugin-message models,
  stable error codes, source parser, and fingerprint canonicalization.
- `packages/domain`: pure visual eligibility, Y→X ordering, pairing/insert
  reorder, blank filtering, and layer-name normalization.
- `apps/plugin/src/main`: selection, current-page node-change freshness,
  snapshots, auth/session transport, provider boundary, fonts, and apply.
- `apps/plugin/src/ui`: auth gate, source input, fixed target slots, movable
  Sheet cards, Skip/Include again, keyboard reorder, and status states.
- `apps/backend/src`: OAuth flow/session lifecycle, Google identity policy,
  private Sheet reads, feature-gated public QA reads, retry/error mapping,
  Firestore/KMS adapters, and operational health routes.

## Apply transaction

1. The controller re-resolves the preview root and compares target IDs/order,
   copy, visibility, bounds, and page.
2. It re-reads the Sheet fingerprint through the selected provider.
3. It resolves every target, rejects locks, and loads every required font.
4. It establishes an undo boundary and synchronously updates changed nodes.
   Characters use the first-character style helper where supported; the final
   layer name is normalized copy and `autoRename` is deterministic.
5. On an unexpected mutation failure it triggers undo, verifies backups, and
   manually restores characters/name/autoRename when necessary.

There are no network calls or font awaits after mutation begins. A preview
token is single-use and active pairs are validated against the fetched source
IDs and exact values.

## Figma scope

The manifest uses `dynamic-page` access and only allows Frame, Component, or
Instance roots. Discovery walks selected-root descendants, rejects hidden or
zero-opacity content, intersects bounds and clipping ancestors, includes
partial visibility, and prefers a user-correctable false positive for unusual
rendering. No sibling occlusion analysis or whole-page fallback is performed.

## Change log

| Date       | Change                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-21 | Replaced the v1 single-file/public-Sheet runtime with the v2.2 TypeScript workspace, controller/UI/backend boundary, tests, CI, Terraform, and documentation. |
