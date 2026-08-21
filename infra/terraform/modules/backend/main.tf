resource "google_project_service" "required" {
  for_each = toset(["run.googleapis.com", "firestore.googleapis.com", "cloudkms.googleapis.com", "secretmanager.googleapis.com", "monitoring.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com"])
  project  = var.project_id
  service  = each.value
}

resource "google_service_account" "backend" {
  project      = var.project_id
  account_id   = "${var.service_name}-runtime"
  display_name = "UX Copy Sync Cloud Run runtime"
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_artifact_registry_repository" "backend" {
  project       = var.project_id
  location      = var.region
  repository_id = "${var.service_name}-images"
  description   = "Container images for ${var.service_name}"
  format        = "DOCKER"
  depends_on    = [google_project_service.required]
}

resource "google_project_iam_member" "cloud_build_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${data.google_project.current.number}@cloudbuild.gserviceaccount.com"
}

resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"
}

resource "google_firestore_field" "auth_flow_ttl" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "authFlows"
  field      = "purgeAt"
  ttl_config {}
}

resource "google_firestore_field" "session_ttl" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "sessions"
  field      = "purgeAt"
  ttl_config {}
}

resource "google_kms_key_ring" "backend" {
  project  = var.project_id
  name     = "${var.service_name}-ring"
  location = var.region
}

resource "google_kms_crypto_key" "refresh_tokens" {
  name            = "refresh-tokens"
  key_ring        = google_kms_key_ring.backend.id
  rotation_period = "7776000s"
}

resource "google_secret_manager_secret" "session_pepper" {
  project   = var.project_id
  secret_id = "${var.service_name}-session-pepper"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "oauth_client_secret" {
  project   = var.project_id
  secret_id = "${var.service_name}-oauth-client-secret"
  replication {
    auto {}
  }
}

resource "google_project_iam_member" "firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_kms_crypto_key_iam_member" "kms" {
  crypto_key_id = google_kms_crypto_key.refresh_tokens.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_secret_manager_secret_iam_member" "pepper" {
  secret_id = google_secret_manager_secret.session_pepper.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_secret_manager_secret_iam_member" "oauth_secret" {
  secret_id = google_secret_manager_secret.oauth_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_cloud_run_v2_service" "backend" {
  project  = var.project_id
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.backend.email
    containers {
      image = var.container_image
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "ALLOWED_GOOGLE_WORKSPACE_DOMAIN"
        value = var.allowed_workspace_domain
      }
      env {
        name  = "ENABLE_PUBLIC_SHEET_TEST_MODE"
        value = tostring(var.enable_public_sheet_test_mode)
      }
      env {
        name  = "GOOGLE_OAUTH_CLIENT_ID"
        value = var.oauth_client_id
      }
      env {
        name  = "GOOGLE_OAUTH_REDIRECT_URI"
        value = var.oauth_redirect_uri
      }
      env {
        name  = "GOOGLE_CLOUD_KMS_KEY"
        value = google_kms_crypto_key.refresh_tokens.id
      }
      env {
        name  = "FIRESTORE_DATABASE"
        value = "(default)"
      }
      env {
        name = "SESSION_TOKEN_PEPPER"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.session_pepper.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "GOOGLE_OAUTH_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.oauth_client_secret.secret_id
            version = "latest"
          }
        }
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_monitoring_alert_policy" "server_errors" {
  project      = var.project_id
  display_name = "${var.service_name} backend 5xx rate"
  combiner     = "OR"
  conditions {
    display_name = "Cloud Run 5xx responses"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.service_name}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}

output "service_url" {
  value = google_cloud_run_v2_service.backend.uri
}

output "artifact_registry_repository" {
  value = google_artifact_registry_repository.backend.name
}

output "kms_key_name" {
  value = google_kms_crypto_key.refresh_tokens.id
}
