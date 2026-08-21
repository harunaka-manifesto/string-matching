# UX Copy Sync infrastructure

Each environment provisions a Cloud Run backend, Firestore database with TTL
cleanup for auth flows/sessions, Cloud KMS, Secret Manager entries, an Artifact
Registry repository, least-privilege runtime IAM, and a 5xx alert.

Use a separate Google Cloud project for `dev`, `staging`, and `prod`. Supply the
project, image, and Workspace domain as Terraform variables. Populate the
OAuth client secret and session-pepper secret through Secret Manager; do not
commit values or service-account JSON keys.

Google Auth Platform/OAuth client creation remains a deliberate manual step:
create an Internal audience, add the Cloud Run callback URI, and copy the
generated client ID/secret into the environment's secret/configuration flow.
Production keeps `enable_public_sheet_test_mode = false`.

Deploy in this order:

1. Apply Terraform to create the secret containers, KMS key, Artifact Registry,
   and runtime IAM.
2. Add a session-pepper secret version and an OAuth-client-secret version in
   Secret Manager. Cloud Run must not be deployed before both versions exist.
3. Build and push the image to the Artifact Registry repository output, then
   deploy Cloud Run with that image.

The Cloud Build service account is granted Artifact Registry write access by the
module. Use the emitted repository name instead of a placeholder `gcr.io` image.
