# Operations

Use separate Google Cloud projects for development, staging, and production.
Terraform provisions Cloud Run, Firestore native mode, a KMS key, Secret
Manager entries, a dedicated runtime service account, IAM, Artifact Registry,
Firestore TTL policies for expired auth flows/sessions, and a Cloud Run 5xx
alert.

Google Auth Platform setup remains manual: create an Internal audience in each
project, create the web OAuth client, add the exact Cloud Run `/oauth/callback`
URI, and obtain Workspace administrator approval under app-access controls.
Store the client secret and session pepper in Secret Manager. Configure the KMS
key resource name and grant only the Cloud Run service account encrypt/decrypt
access. Do not create downloadable service-account JSON keys.

GitHub Actions uses Workload Identity Federation for deployment. Production
Terraform sets `ENABLE_PUBLIC_SHEET_TEST_MODE=false`; production plugin builds
allow only the configured backend origin. Rotate the OAuth secret, pepper, and
KMS key according to the organization's schedule. Revoke sessions and delete
the user's encrypted credential when Google consent is revoked.

Monitor Cloud Run 5xx rate, p95 latency, OAuth failures, Google 429s, and Sheet
error codes. Logs contain request ID, route, status, latency, plugin version,
error code, and counts only—not copy, URLs, bearer tokens, OAuth codes, or
Google identity secrets.
