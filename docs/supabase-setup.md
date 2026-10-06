# Deploying the registry

No remote project has been configured for this checkout. Local development runs a mock registry without authentication. Production requires the project URL and configured team token; missing configuration keeps drafts and existing Figma Apply available, and disables registry saves.

## 1. Project and secrets

Create a Supabase project in Singapore. Use Node 22 and the Supabase CLI. Do not add `copy_private` to the exposed API schemas. Registry tables and mutation RPCs deny `anon` and `authenticated`; only the server credential can execute the RPCs. The Edge Function accepts a separate limited team token, and requires a separate publisher token for sync manifests and publication acknowledgements.

Generate two independent random tokens (at least 32 random bytes), hash each with SHA-256, and save them in your team's private credential store. Give writers the internally distributed plugin containing only the team token. Give the maintainer the publisher token for one-time plugin setup. Neither token is a verified personal identity. Supabase's database/secret key must never be embedded in the plugin or entered in the publisher UI.

Use `.env.example` as a field reference. Build scripts read environment variables; they do not automatically load `.env`. Never commit a real `.env` or put credentials in chat, Figma metadata, command history, or logs. Put only `COPY_TEAM_TOKEN_HASHES` and `COPY_PUBLISHER_TOKEN_HASHES` in an ignored private CLI secret file, then upload it:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
pnpm build:backend
supabase db push
supabase secrets set --env-file .env.edge.local
supabase functions deploy copy-registry
```

`supabase/config.toml` disables the platform's user-JWT check because v1 has no user login. The handler always validates the custom token before calling Postgres. Missing or invalid tokens receive 401. A writer cannot elevate privileges by supplying a role in the body. The handler supports OPTIONS preflight and the custom `x-copy-token` header; every data request still requires a valid token. See [Supabase CORS guidance](https://supabase.com/docs/guides/functions/cors). The function uses Supabase's server secret from its runtime environment. See [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth) and [API key guidance](https://supabase.com/docs/guides/getting-started/api-keys).

Token rotation: deploy hashes for old and new credentials together, distribute the updated plugin and publisher token, then remove the old hashes. A revoked token preserves cached drafts but cannot read or write the registry. Requests have database-enforced per-credential limits and retryable 429 responses.

## 2. Bootstrap existing identities

```sh
pnpm prepare:library
pnpm registry:bootstrap
```

The second command is a dry run. It checks the reviewed replacement JSONL, identities, all historical aliases, redirect targets, key ownership, and product configuration in `supabase/products.json`. Resolve ownership errors against the existing ledger before rollout; never create replacement IDs to hide them. Legacy inactive records/tombstones and redirects remain present and reserve keys permanently. Both locales retain exact bytes, including whitespace.

Supply `SUPABASE_URL` and `SUPABASE_ADMIN_KEY` privately to the administrator process, then:

```sh
pnpm registry:bootstrap --apply
```

Bootstrap requires an empty registry. It deliberately does not guess Figma variable mappings. Open GoPay Strings in Figma, enter publisher setup, Check changes, explicitly reconcile the no-baseline variables, and Pull or adopt matching saved records. This attaches committed baselines to existing variables, preserves their variable keys, and registers verified mappings. Missing legacy identity must be resolved against registry key/alias ownership. Review mismatched values before selecting a direction.

## 3. Build the internal plugin

Supply only `COPY_REGISTRY_URL` and `COPY_TEAM_TOKEN` to the build process:

```sh
pnpm build
pnpm sandbox:check
```

Import `apps/plugin/dist/manifest.json` as a Figma development plugin. The generated manifest allows only the configured HTTPS Supabase project origin. A build without a URL denies network access. The publisher token remains in the maintainer's private Figma client storage. Shared Figma metadata contains identity/revision/context only.

## 4. Pilot checks

Run writer creation and immediate local binding, a second writer's competing edit, global update and variant, direct-library Push, Supabase Pull, interrupted sync resume, manual publication and exact verification, and a complete [MCP frame bundle](developer-handoff.md). Include a working file already bound to published variables and verify that a newer saved local revision is never replaced by older published wording.

Local verification runs `pnpm test`, `pnpm test:ui`, `pnpm typecheck`, `pnpm lint`, `pnpm build:backend`, `pnpm build`, and `pnpm sandbox:check`. The Postgres tests use PGlite: queued Promise submissions verify transaction/idempotency behavior, but do not replace a multi-connection concurrent-writer pilot against deployed Supabase. Native-controller and MCP tests use simulated Figma APIs. Real Figma write/publication/tool availability checks require the configured pilot.

## 5. Daily external backups and restore

Keep `COPY_BACKUP_KEY` (32 random bytes encoded in base64) independently from the backup files. With server-only administrator credentials, run daily from an existing trusted runner:

```sh
pnpm registry:backup /PRIVATE_EXTERNAL_PATH/registry.backup.enc
pnpm registry:backup /PRIVATE_EXTERNAL_PATH/registry.backup.enc --restore
```

The backup is a consistent database snapshot including revisions, requests, ordered changes, permanent reservations, manifests and mappings. It is compressed and AES-256-GCM encrypted, created with private file permissions, and never overwrites a previous backup. The second command decrypts and verifies it without writing a database. To test restoration, deploy migrations into a separate fresh empty Supabase project, supply that project's administrator target, then add `--apply` to the restore command. Compare catalog counts, saved revisions, reservations, and idempotent request results afterward. Restoring resets publisher leases. Do not test restore against the live registry.

Measure database storage including history, transfer, invocation counts, save latency, conflicts, partial binding failures, sync lag and publication backlog. Free plan operational limits and backup availability should be checked at rollout: [Supabase pricing](https://supabase.com/pricing). Upgrade the same project when daily use requires the relevant protections. The repository does not create hosting accounts, schedule an external runner, or publish Figma libraries automatically.
