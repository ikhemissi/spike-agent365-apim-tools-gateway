# azd passes every value of main.tfvars.json as a string, empty when the azd environment does not set it. All of them
# come from the layers this one depends on (azure-platform, foundry-model).

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

variable "log_analytics_workspace_id" {
  description = "Log Analytics workspace of the platform layer (PLATFORM_LOG_ANALYTICS_WORKSPACE_ID), for the gateway logs."
  type        = string
}

variable "foundry_account_id" {
  description = "Foundry account of the foundry-model layer (FOUNDRY_ACCOUNT_ID)."
  type        = string

  validation {
    condition     = var.foundry_account_id != ""
    error_message = "FOUNDRY_ACCOUNT_ID is empty: provision the foundry-model layer first."
  }
}

variable "foundry_openai_endpoint" {
  description = "Its OpenAI endpoint (FOUNDRY_OPENAI_ENDPOINT), e.g. https://<account>.openai.azure.com/."
  type        = string
}
