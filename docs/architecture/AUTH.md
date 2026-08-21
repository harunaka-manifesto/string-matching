# Authentication architecture

The production audience is an Internal Google Auth Platform OAuth client. The
requested scopes are `openid`, `email`, and read-only Sheets access. The
backend verifies the Google ID-token signature/audience/issuer/expiry,
`email_verified`, and the trusted `hd` claim. Users are keyed by Google `sub`,
not by an email suffix.

The UI sends `auth:start`; the controller calls `POST /v1/auth/start` and opens
the validated backend URL with `figma.openExternal()`. The browser performs
the OAuth code exchange at the backend callback. The UI owns a one-second poll
timer and sends `auth:poll-tick`; the controller performs that backend request.
The poll result returns the opaque app session to the controller exactly once,
which stores it in client storage and sends only the user email to React.

Flow records use random state, PKCE, short expiry, hashed poll keys, and shared
Firestore storage so Cloud Run instances can scale independently. Sessions are
random, product-scoped, revocable bearers. Firestore stores only their hashes;
idle/absolute expiry is enforced by `SessionService`. Google refresh tokens and
short-lived auth completion secrets are encrypted with Cloud KMS. Secret
Manager supplies the OAuth secret and session pepper to Cloud Run.

Disconnect revokes app sessions, removes the stored Google credential, attempts
to clear local state, and returns the plugin to the auth gate. Public test mode
is memory-only, does not start OAuth, and is not persisted across launches.
