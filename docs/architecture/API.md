# Backend API

All versioned endpoints are JSON, return `X-Request-Id`, accept
`X-Plugin-Version`, validate Zod schemas, and use stable error codes. Bearer
authentication means `Authorization: Bearer <opaque-app-session>`.

| Method | Path                             | Purpose                                                   |
| ------ | -------------------------------- | --------------------------------------------------------- |
| POST   | `/v1/auth/start`                 | Create a five-minute OAuth/PKCE handoff.                  |
| GET    | `/v1/auth/poll?flowId=&readKey=` | Return pending or one-time completion.                    |
| GET    | `/oauth/callback`                | Browser-only OAuth callback; no token in HTML.            |
| GET    | `/v1/session`                    | Validate the app session and return display email.        |
| POST   | `/v1/session/logout`             | Revoke the current app session.                           |
| POST   | `/v1/session/disconnect`         | Revoke the user's sessions and delete Google credentials. |
| POST   | `/v1/sheets/copy`                | Read private Sheet copy for the authenticated user.       |
| POST   | `/v1/sheets/verify`              | Recompute the reviewed source fingerprint.                |
| POST   | `/v1/test/public-sheets/copy`    | Development-only anonymous public read.                   |
| POST   | `/v1/test/public-sheets/verify`  | Development-only public fingerprint check.                |
| GET    | `/healthz`, `/readyz`            | Infrastructure checks without Google calls.               |

Copy requests contain `{ cellUrl, requestedCount }`. Verify requests add
`expectedFingerprint`. Copy responses include Sheet provenance, exact returned
values with physical `row`/`cell`, scan metadata, and a SHA-256 fingerprint.
Public test routes are not registered when `ENABLE_PUBLIC_SHEET_TEST_MODE` is
false.

Retryable Google 429/5xx reads use at most three attempts with truncated
exponential backoff and jitter. Sheet values, OAuth codes, tokens, and source
URLs are not included in logs or errors.
