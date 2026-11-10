# The project's infrastructure is this one Terraform root: each file is one part of the architecture, calling a module
# of infra/modules and wiring it to the other parts through their outputs. This file holds what every part shares:
# names, tags and the resource group. Outputs become azd environment values, read by the services, the hooks
# and the scripts; none of them is a secret.

variable "environment_name" {
  description = "azd environment name (AZURE_ENV_NAME); prefixes resource names and is set as the azd-env-name tag."
  type        = string
}

variable "subscription_id" {
  description = "Target subscription (AZURE_SUBSCRIPTION_ID)."
  type        = string
}

variable "location" {
  description = "Region of every resource (AZURE_LOCATION)."
  type        = string
}

variable "tags" {
  description = "Extra tags on every resource, as comma-separated key=value pairs (RESOURCE_TAGS), e.g. tags required by your tenant's policies. Empty: none."
  type        = string

  validation {
    condition     = alltrue([for pair in split(",", var.tags) : trimspace(pair) == "" || can(regex("^[^=]+=.*$", trimspace(pair)))])
    error_message = "tags must be comma-separated key=value pairs."
  }
}

data "azurerm_client_config" "current" {}

locals {
  # Keeps globally unique names unique per subscription and environment.
  token = substr(sha1("${var.subscription_id}-${var.environment_name}"), 0, 8)
  # For names that accept only lowercase letters and digits (registry, storage).
  compact_name = substr(replace(lower(var.environment_name), "/[^a-z0-9]/", ""), 0, 10)

  # Extra tags from RESOURCE_TAGS ("key=value,key=value"); everything after the first "=" is the value.
  extra_tag_pairs = [for pair in split(",", var.tags) : split("=", pair) if trimspace(pair) != ""]
  extra_tags = {
    for pair in local.extra_tag_pairs : trimspace(pair[0]) => trimspace(join("=", slice(pair, 1, length(pair))))
  }
  tags = merge(local.extra_tags, { "azd-env-name" = var.environment_name })
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${var.environment_name}"
  location = var.location
  tags     = local.tags
}

output "AZURE_RESOURCE_GROUP" { value = azurerm_resource_group.main.name }
output "AZURE_TENANT_ID" { value = data.azurerm_client_config.current.tenant_id }
