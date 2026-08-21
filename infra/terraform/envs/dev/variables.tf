variable "project_id" {
  type = string
}
variable "region" {
  type    = string
  default = "asia-southeast1"
}
variable "container_image" {
  type    = string
  default = "gcr.io/example/ux-copy-sync:dev"
}
variable "allowed_workspace_domain" {
  type = string
}

variable "oauth_client_id" {
  type = string
}

variable "oauth_redirect_uri" {
  type = string
}
