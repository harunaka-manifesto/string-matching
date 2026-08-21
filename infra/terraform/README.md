# UX Copy Sync infrastructure

Each environment provisions a Cloud Run backend, Firestore database, Cloud KMS
key, Secret Manager entries, least-privilege runtime IAM, and a 5xx alert.

Use a separate Google Cloud project for `dev`, `staging`, and `prod`. Supply the
project, image, and Workspace domain as Terraform variables. Populate the
OAuth client secret and session-pepper secret through Secret Manager; do not
commit values or service-account JSON keys.

Google Auth Platform/OAuth client creation remains a deliberate manual step:
create an Internal audience, add the Cloud Run callback URI, and copy the
generated client ID/secret into the environment's secret/configuration flow.
Production keeps `enable_public_sheet_test_mode = false`.
