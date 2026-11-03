# azd passes every value of main.tfvars.json as a string, empty when the azd environment does not set it.

variable "environment_name" {
  description = "azd environment name (AZURE_ENV_NAME)."
  type        = string
}

variable "subscription_id" {
  description = "Target subscription (AZURE_SUBSCRIPTION_ID)."
  type        = string
}

variable "location" {
  description = "Region (AZURE_LOCATION)."
  type        = string
  default     = "francecentral"
}

variable "tags" {
  description = "Extra tags, as comma-separated key=value pairs (RESOURCE_TAGS). Empty: none."
  type        = string
  default     = ""
}

variable "resource_group_name" {
  description = "Resource group of the platform layer (AZURE_RESOURCE_GROUP)."
  type        = string

  validation {
    condition     = var.resource_group_name != ""
    error_message = "AZURE_RESOURCE_GROUP is empty: provision the azure-platform layer first."
  }
}

variable "container_app_environment_id" {
  description = "Container Apps environment of the platform layer (AZURE_CONTAINER_APPS_ENVIRONMENT_ID)."
  type        = string
}

variable "registry_server" {
  description = "Container registry of the platform layer (AZURE_CONTAINER_REGISTRY_ENDPOINT), where azd builds the image."
  type        = string
}

variable "acr_pull_identity_id" {
  description = "The platform's image-pull identity (PLATFORM_ACR_PULL_IDENTITY_ID)."
  type        = string
}

variable "allowed_caller_id" {
  description = "Object id of the one caller allowed through external ingress, e.g. API Management's managed identity (NOTES_MCP_ALLOWED_CALLER_ID). Empty: internal ingress only, no token check."
  type        = string
  default     = ""
}

variable "apim_principal_id" {
  description = "API Management gateway's managed identity (APIM_PRINCIPAL_ID), the allowed caller when allowed_caller_id is empty. Empty: no API Management."
  type        = string
  default     = ""
}

variable "image" {
  description = "Image deployed by azd (SERVICE_NOTES_MCP_IMAGE_NAME); empty before the first deployment."
  type        = string
  default     = ""
}
