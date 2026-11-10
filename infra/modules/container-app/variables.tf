variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "container_apps_environment_id" {
  type = string
}

variable "registry_server" {
  description = "The registry azd pushes the service's image to (login server)."
  type        = string
}

variable "registry_pull_identity_id" {
  description = "The identity with AcrPull on that registry (the container-registry module's output)."
  type        = string
}

variable "azd_service_name" {
  description = "The service's name in azure.yaml; also the container's name."
  type        = string
}

variable "image" {
  description = "The image azd deployed (SERVICE_<NAME>_IMAGE_NAME). Empty until the first deployment: placeholder image."
  type        = string
  default     = ""
}

variable "port" {
  description = "The port the service listens on."
  type        = number
}

variable "health_path" {
  description = "The service's readiness endpoint."
  type        = string
  default     = "/health"
}

variable "external" {
  description = "Reachable from the internet; false: only from the apps of the same environment."
  type        = bool
  default     = false
}

variable "cpu" {
  type    = number
  default = 0.25
}

variable "memory" {
  type    = string
  default = "0.5Gi"
}

variable "env" {
  description = "Environment variables (no secrets)."
  type        = map(string)
  default     = {}
}

variable "application_insights_connection_string" {
  description = "Sets APPLICATIONINSIGHTS_CONNECTION_STRING; give the identity Monitoring Metrics Publisher on the resource too (role_assignments). Null: no telemetry."
  type        = string
  default     = null
  sensitive   = true
}

variable "role_assignments" {
  description = "Roles of the app's identity, by a name of your choice: the scope and the role name."
  type = map(object({
    scope = string
    role  = string
  }))
  default = {}
}

variable "key_vault_secrets" {
  description = "Environment variables read from Key Vault by the app's identity, by variable name: the secret's versionless URI (https://<vault>.vault.azure.net/secrets/<name>). Give the identity Key Vault Secrets User on each secret too (role_assignments)."
  type        = map(string)
  default     = {}
}
