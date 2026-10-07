# Setting up the Supabase registry

This takes the registry from nothing to a working plugin. Do the steps in order; each ends with a check that tells you it worked. Steps 1–6 take about an hour. Step 7 depends on how much of the library needs reviewing.

Until this is done the plugin still runs: Apply existing copies works from the Figma library, and Create new copies keeps drafts but cannot save.

## What you end up with

| Thing                 | Who holds it              | Where it lives                                |
| --------------------- | ------------------------- | --------------------------------------------- |
| Supabase project      | You (administrator)       | supabase.com, Singapore region                |
| Team token            | Every writer, unknowingly | Baked into the plugin build                   |
| Publisher token       | The library maintainer    | Typed once into Library sync, on their device |
| Supabase secret key   | You only                  | Your machine, for the import and backups      |
| Backup encryption key | You only                  | Your password manager, apart from the backups |

The two tokens are random strings you generate. Supabase only ever stores their SHA-256 hashes. Neither token proves who a person is; the publisher token only unlocks library sync.

**Never** put the Supabase secret key in the plugin build, the publisher setup field, a Figma file, or a chat message.

## Before you start

- Node 22 (`nvm use`) and `pnpm install` done in this repository.
- The Supabase CLI: `supabase --version` prints a version. Install it with `brew install supabase/tap/supabase` if not.
- A Supabase account that can create a project.

## Step 1 — Create the project

1. On [supabase.com](https://supabase.com/dashboard), create a project. Region: **Southeast Asia (Singapore)**. Save the database password it asks for in your password manager.
2. Note the **project ref**: the id in the project URL, `https://supabase.com/dashboard/project/<project-ref>`.
3. In **Project Settings → API Keys**, copy the **secret key** (starts with `sb_secret_`; on older projects it is the `service_role` key). This is the administrator credential.

Leave every other setting alone. In particular, do not add `copy_private` to the exposed schemas.

## Step 2 — Generate the two tokens

Run this once. It prints two tokens and their hashes.

```sh
for name in TEAM PUBLISHER; do
  token=$(openssl rand -base64 32)
  echo "$name token: $token"
  echo "$name hash:  $(printf %s "$token" | shasum -a 256 | cut -d' ' -f1)"
done
```

Save both tokens in your password manager now. A token cannot be recovered from its hash.

## Step 3 — Create three private files

All three are ignored by git (`.env.*`). Create them in the repository root with your values. `.env.example` lists the same fields.

`.env.edge.local` holds the hashes, uploaded to Supabase in step 4:

```sh
COPY_TEAM_TOKEN_HASHES=<TEAM hash>
COPY_PUBLISHER_TOKEN_HASHES=<PUBLISHER hash>
```

`.env.admin.local` holds administrator credentials, used by the import and backups:

```sh
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ADMIN_KEY=<secret key from step 1>
COPY_BACKUP_KEY=<output of: openssl rand -base64 32>
```

`.env.plugin.local` holds the only values that go into the plugin:

```sh
COPY_REGISTRY_URL=https://<project-ref>.supabase.co/functions/v1/copy-registry
COPY_TEAM_TOKEN=<TEAM token>
```

The scripts do not read these files by themselves. Each later step loads the one it needs with `set -a; source <file>; set +a`.

## Step 4 — Deploy the database and the function

```sh
supabase login
supabase link --project-ref <project-ref>
pnpm build:backend
supabase db push
supabase secrets set --env-file .env.edge.local
supabase functions deploy copy-registry
```

`supabase link` and `supabase db push` ask for the database password from step 1. `supabase db push` lists the pending migrations and asks you to confirm.

**Check.** Both commands must behave as described.

```sh
set -a; source .env.plugin.local; set +a
curl -s -o /dev/null -w '%{http_code}\n' "$COPY_REGISTRY_URL/catalog"
curl -s -H "x-copy-token: $COPY_TEAM_TOKEN" "$COPY_REGISTRY_URL/catalog"
```

- The first prints `401`: no token, no access.
- The second prints `{"seq":0,"records":[],"products":[],"mappings":[]}`: the token works and the registry is empty.

If the second also returns 401, the hash in `.env.edge.local` does not match the token. Redo step 2 and run `supabase secrets set` again.

## Step 5 — Import the existing copy

This loads the 20,602 existing identities with every historical key. It only works on an empty registry, so it cannot be run twice by accident.

```sh
pnpm prepare:library
pnpm registry:bootstrap
```

The second command is a dry run and changes nothing. It must finish without an error and print a summary containing:

```json
{ "mode": "dry-run", "records": 20602, "reservedKeys": 38718, "keyResolutions": 62 }
```

If it says it is **blocked by key ownership conflicts**, see [Key ownership](#key-ownership). Do not continue until the dry run is clean.

Then import for real:

```sh
set -a; source .env.admin.local; set +a
pnpm registry:bootstrap --apply
```

It ends with `{ imported: 20602, reservedKeys: 38718, history: … }`.

**Check.**

```sh
set -a; source .env.plugin.local; set +a
curl -s -H "x-copy-token: $COPY_TEAM_TOKEN" "$COPY_REGISTRY_URL/changes?after=0" | head -c 200
```

The response starts with `{"seq":500,"events":[{"type":"copy",`.

The import is about 73 MB, more than one API request or one database statement may carry. So it uploads roughly 80 small chunks, then applies them one at a time, printing a line for each. Expect a few minutes.

If it stops partway, run the same command again. It removes the unfinished import and starts over; it will not touch a registry that is finished or in use. Run after a successful import, it reports `alreadyImported` and changes nothing.

Do not distribute the plugin until the import has printed `{ imported: 20602, … }`: while it runs, the registry holds only part of the copy.

## Step 6 — Build the plugin

```sh
set -a; source .env.plugin.local; set +a
pnpm build
pnpm sandbox:check
```

`pnpm sandbox:check` prints `Plugin controller sandbox contract passed.` It also confirms the plugin may talk to your Supabase project and nothing else.

In Figma, choose **Plugins → Development → Import plugin from manifest…** and pick `apps/plugin/dist/manifest.json`.

**Check.** Open the plugin in any file. The status line under the header shows a green dot and `Updated <time>`. An amber `Offline · …` line means the URL or team token in `.env.plugin.local` is wrong; fix it and rebuild.

Give writers the `apps/plugin/dist` folder. Build it in a shell that has not loaded `.env.admin.local`.

## Step 7 — Connect the GoPay Strings library

The maintainer does this once, on their own device. The import in step 5 deliberately did not guess which Figma variable belongs to which record; this step attaches them.

1. Open the **GoPay Strings** library file in Figma. Setup is refused in any other file.
2. Run the plugin and choose **Library sync**.
3. Leave Library ID as `gopay-strings`, check the Figma library URL is the file you have open, paste the **publisher token**, and choose **Save on this device**.
4. Choose **Check changes**. Existing variables show **Needs initial reconciliation**.
5. Choose **Select Adopt for the next 5000** (the last round reads **Select Adopt for all N**). This picks variables whose EN and ID already match the saved record exactly; adopting changes no wording.
6. Choose **Review changes**, then **Confirm Push / Pull**. The result reads **Library draft updated · needs publish**.
7. Publish the library through Figma as usual, then choose **Verify publication**.
8. Repeat 4–7 until the adopt button no longer appears. With about 20,000 variables that is four or five rounds. Verify each round before starting the next: verification covers only the most recent round.

What remains are variables whose wording differs from the saved record. Each shows the Figma and Supabase values. Pick **Use Supabase / Pull** or **Use Figma / Push** one at a time, then review, confirm, publish and verify as above.

A legacy variable flagged **Resolve this legacy variable against the registry** has a name that matches no saved key. Six old keys are intentionally in this state; see [Key ownership](#key-ownership).

To replace a rotated publisher token or a wrong URL later, use **Change setup** in Library sync.

## Step 8 — Run the pilot

Do each of these once with real people and a real file before rolling out:

1. A writer creates a string in a frame; it binds immediately.
2. A second writer edits the same string at the same time; the second save shows a conflict, not an overwrite.
3. A global edit and a screen-specific variant.
4. The maintainer edits a variable directly in the library and pushes it.
5. The maintainer pulls a writer's change into the library.
6. Close the plugin halfway through a sync, reopen, and resume.
7. Publish and verify.
8. A developer extracts a [frame bundle](developer-handoff.md).

Include one working file already bound to published variables, and confirm newer saved wording is never replaced by older published wording.

`pnpm test:staging` runs ten concurrent writers against a configured registry. Point it at a disposable project, never the live one.

## Step 9 — Schedule backups

The Free plan has no automatic backups and pauses after inactivity. Run this daily from a machine you trust:

```sh
set -a; source .env.admin.local; set +a
pnpm registry:backup /private/external/path/registry-$(date +%F).backup.enc
```

The file is compressed, encrypted with `COPY_BACKUP_KEY` (AES-256-GCM), and never overwrites an earlier one. Keep the key somewhere other than the backups.

Verify a backup without touching any database:

```sh
pnpm registry:backup /private/external/path/registry-2026-10-07.backup.enc --restore
```

Test a real restore once during the pilot: create a second, empty Supabase project, repeat step 4 on it, point `.env.admin.local` at it, and add `--apply`. Compare record and revision counts. Never restore onto the live registry. Restoring clears publisher leases.

## Maintenance

**Rotating a token.** Generate a new token and hash (step 2). Put the old and new hashes together, comma-separated, in `.env.edge.local` and run `supabase secrets set --env-file .env.edge.local`. Distribute the rebuilt plugin (team token) or have the maintainer use **Change setup** (publisher token). Then remove the old hash and set the secrets again. A revoked token keeps local drafts but cannot read or write.

**Changing the function.** `pnpm build:backend && supabase functions deploy copy-registry`.

**Local development.** `pnpm dev:ui` runs the whole UI against a mock registry with no credentials. To run a development plugin against `supabase functions serve`, build with `COPY_REGISTRY_URL=http://localhost:54321/functions/v1/copy-registry` and `COPY_ALLOW_LOCAL_REGISTRY=1`. Never distribute that build; `pnpm sandbox:check` rejects it in CI.

**Capacity.** Watch database size (revision history grows), function invocations and save latency in the Supabase dashboard. Upgrade the same project to Pro when daily use needs automatic backups and no pausing: [Supabase pricing](https://supabase.com/pricing).

## Key ownership

Every developer key, current or historical, must belong to exactly one identity. In the migrated data, 62 old keys were claimed by more than one. They are resolved in `figma-copy-migration/registry/key-ownership-resolutions.json`, which the import applies. No identity was created, merged or removed.

| Rule                | Keys | Decision                                                                                                                                                 |
| ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current-key`       | 53   | An identity uses the key today. It owns the key; other identities stop listing it as an alias.                                                           |
| `ledger-former-key` | 3    | No identity uses it today, but the migration ledger shows one claimant once had it as its own key. That identity keeps it.                               |
| `ambiguous`         | 6    | The old sheet used one key for different strings, such as a push title and its body. The key stays reserved forever and points to no identity's wording. |

An ambiguous key is never matched automatically: a legacy variable with that name is flagged for the maintainer instead. Each decision is also written into the registry's migration history at import. The original legacy row, with its full key list, stays attached to every record.

To change a decision before importing, edit that file: set `owner`, and list under `released` the identities that give the key up. If the prepared registry changes and the import reports the file no longer matches, run `pnpm registry:resolve-keys` to regenerate it, then review the diff.

## Troubleshooting

| Symptom                                                | Cause and fix                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `401` with a token                                     | Hash does not match the token, or secrets were not set. Redo steps 2–4.                                  |
| `403 Publisher credential required`                    | The team token was pasted into publisher setup. Use the publisher token.                                 |
| `503 Registry operation unavailable`                   | Database unreachable or project paused. Resume the project in the dashboard; pending saves retry safely. |
| `429`                                                  | More than 180 requests a minute on one token. Wait a minute.                                             |
| Import: `…copy_registry_bootstrap_status failed (404)` | The staging migration is missing. Run `supabase db push`, then the import again.                         |
| Build: `COPY_REGISTRY_URL must be your HTTPS…`         | URL is not exactly `https://<project-ref>.supabase.co/functions/v1/copy-registry`.                       |
| Setup: `Open the registered GoPay Strings file…`       | Publisher setup was attempted in a file that is not the library.                                         |
| Sync: `Another publisher is syncing`                   | A second maintainer holds the two-minute lease. Wait, then Check changes again.                          |

## What the local tests do and do not prove

`pnpm test`, `pnpm test:ui`, `pnpm typecheck`, `pnpm lint`, `pnpm build:backend`, `pnpm build` and `pnpm sandbox:check` all run without a Supabase project. The database tests use an in-process Postgres and simulated Figma APIs. They do not replace the pilot in step 8: real concurrent connections, real Figma writes and real library publication are only exercised there.
