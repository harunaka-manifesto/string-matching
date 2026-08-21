# System architecture

## Runtime responsibilities

The React UI owns display state, source-link validation, pairing, Skip, card
reorder, keyboard affordances, and the auth polling cadence. It receives only
safe projections and never receives app-session or Google tokens.

The Figma controller owns the app session, all backend requests, selection and
target discovery, preview tokens, current-page freshness observation, Locate,
font loading, and the synchronous Apply transaction. `figma.clientStorage`
contains only the opaque revocable app-session bearer.

The Cloud Run backend owns Google OAuth, Workspace identity validation, session
hashes, encrypted refresh credentials, Sheet metadata/tab resolution, bounded
values reads, source fingerprints, and stable errors. It does not persist Sheet
copy.

## Shared contract

`packages/contracts` is the boundary for Zod schemas. `UiToPluginMessageSchema`
and `PluginToUiMessageSchema` validate every message. Backend request/response
schemas validate JSON at route and client boundaries. Deterministic rules live
in `packages/domain` so the controller, backend, and tests do not invent
different pairing or normalization behavior.

## Source provider

Authenticated and public-test providers implement the same `fetchCopy` and
`verifyCopy` interface. The public provider is registered only when the feature
flag is true. Everything after source retrieval—target discovery, pairing,
stale-Figma checks, naming, Apply, undo, and rollback—is provider agnostic.
