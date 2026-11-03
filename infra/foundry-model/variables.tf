# azd passes every value of main.tfvars.json as a string, empty when the azd environment does not set it: optional
# settings are strings whose empty value selects the default in main.tf (locals, through coalesce).

variable "environment_name" {
  description = "azd environment name (AZURE_ENV_NAME)."
  type        = string
}

variable "subscription_id" {
  description = "Target subscription (AZURE_SUBSCRIPTION_ID)."
  type        = string
}

variable "location" {
  description = "Region of the Foundry account (AZURE_LOCATION)."
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

variable "application_insights_id" {
  description = "Application Insights of the platform layer (PLATFORM_APPLICATION_INSIGHTS_ID), connected to the Foundry project for tracing."
  type        = string
}

variable "application_insights_connection_string" {
  description = "Its connection string (PLATFORM_APPLICATION_INSIGHTS_CONNECTION_STRING); locates the resource, ingestion still requires Entra."
  type        = string
  sensitive   = true
}

variable "model_name" {
  description = "Foundry chat model (MODEL_NAME). Empty: gpt-6-luna."
  type        = string
  default     = ""
}

variable "model_version" {
  description = "Model version (MODEL_VERSION). Empty: 2026-09-22."
  type        = string
  default     = ""
}

variable "model_sku" {
  description = "Deployment SKU (MODEL_SKU), e.g. DataZoneStandard to keep data in the EU data zone. Empty: DataZoneStandard."
  type        = string
  default     = ""
}

variable "model_capacity" {
  description = "Deployment capacity in thousands of tokens per minute (MODEL_CAPACITY). Empty: 50."
  type        = string
  default     = ""
}
