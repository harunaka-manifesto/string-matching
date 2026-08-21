# UX Copy Sync

UX Copy Sync is a Figma plugin for bringing approved UX copy from a private
Google Sheet into one selected Frame, Component, or Instance. It keeps the
Figma destination order fixed, lets writers reorder Sheet-copy cards, and
requires a review before any text or layer name changes are written.

For the writer-facing workflow, read [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Repository map

```text
apps/plugin/      React UI, Figma controller, build and development manifest
apps/backend/     Fastify OAuth/session/Sheets service
packages/contracts/ shared Zod models, errors, parser, and message contracts
packages/domain/  pure visibility, reading-order, pairing, scan, and naming rules
infra/terraform/  dev, staging, and production Cloud Run infrastructure
docs/             user guide and architecture/operations/testing references
```

## Prerequisites

- Node.js 22 LTS
- pnpm 11
- Figma desktop or browser for manual plugin QA
- Google Cloud access for private-Sheet/OAuth deployment

Install and validate from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Local development

Run the backend with a local environment file:

```bash
cp apps/backend/.env.example apps/backend/.env
pnpm --filter @ux-copy-sync/backend build
pnpm --filter @ux-copy-sync/backend start
```

The development UI harness uses the real React UI against a mock Figma bridge:

```bash
pnpm dev:ui
```

It exposes authenticated, six-target fixture data so UI iteration does not
require opening Figma. The mock bridge is compile-time development code and is
not included in the production plugin bundle.

Public Sheet test mode is deliberately opt-in for local/staging QA:

```bash
pnpm --filter @ux-copy-sync/backend build
ENABLE_PUBLIC_SHEET_TEST_MODE=true pnpm --filter @ux-copy-sync/backend start
pnpm build:plugin:dev
```

The development build uses `http://localhost:8787` and Figma's
`devAllowedDomains` network contract. Test mode accepts only public Viewer
Sheets and is never enabled by the production Terraform environment or
production manifest.

## Build and import

```bash
BACKEND_BASE_URL=https://your-backend.example.com pnpm build:plugin:prod
```

Import `apps/plugin/dist/manifest.json` in Figma development mode. This is the
only runnable manifest; `apps/plugin/manifest.base.json` is a build template and
must not be imported directly. The build emits a self-contained `ui.html`, a
bundled controller, and validates that the manifest's `main`/`ui` paths exist.

## Deployment

The backend container uses the pinned Node 22 image in `Dockerfile`. Terraform
provisions Cloud Run, Firestore, KMS, Secret Manager access, runtime IAM, and a
basic 5xx alert. See [infra/terraform/README.md](infra/terraform/README.md) and
[docs/architecture/OPERATIONS.md](docs/architecture/OPERATIONS.md) for the
manual Google Auth Platform steps and environment setup.

The GitHub Actions workflows validate pull requests, build the plugin artifact,
and provide a keyless deployment path using Workload Identity Federation.
