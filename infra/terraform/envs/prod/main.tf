module "backend" {
  source = "../../modules/backend"
  project_id = var.project_id
  region = var.region
  service_name = "ux-copy-sync-prod"
  container_image = var.container_image
  allowed_workspace_domain = var.allowed_workspace_domain
  enable_public_sheet_test_mode = false
  oauth_client_id = var.oauth_client_id
  oauth_redirect_uri = var.oauth_redirect_uri
  firestore_location = "asia-southeast2"
}
