# Shared platform layer: the resource group, observability, secrets, the image registry and the Container Apps
# environment that the workload layers (infra/<block>/) deploy into. Workload layers read its outputs as azd values.

data "azurerm_client_config" "current" {}

locals {
  # Suffix that keeps globally unique resource names unique per subscription and environment (same in every layer).
  token = substr(sha1("${var.subscription_id}-${var.environment_name}"), 0, 8)
  # Alphanumeric prefix for resources that do not accept hyphens (registry).
  compact = substr(replace(lower(var.environment_name), "/[^a-z0-9]/", ""), 0, 10)

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

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${var.environment_name}-${local.token}"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${var.environment_name}-${local.token}"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "other"
  # Ingestion requires an Entra token (Monitoring Metrics Publisher): no instrumentation key works.
  local_authentication_enabled = false
  tags                         = local.tags
}

resource "azurerm_container_registry" "main" {
  name                   = "cr${local.compact}${local.token}"
  resource_group_name    = azurerm_resource_group.main.name
  location               = var.location
  sku                    = "Basic"
  admin_enabled          = false
  anonymous_pull_enabled = false
  tags                   = local.tags
}

# Shared image-pull identity: container apps pull from the registry with it, never with registry credentials.
resource "azurerm_user_assigned_identity" "acr_pull" {
  name                = "id-acr-pull-${local.token}"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.acr_pull.principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_key_vault" "main" {
  name                          = "kv-${substr(var.environment_name, 0, 10)}-${local.token}"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = var.location
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = false
  soft_delete_retention_days    = 7
  public_network_access_enabled = true
  tags                          = local.tags
}

# The principal running azd writes the secrets that workload layers generate (e.g. a gateway's admin key).
resource "azurerm_role_assignment" "deployer_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_container_app_environment" "main" {
  name                = "cae-${var.environment_name}-${local.token}"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  # Logs flow through Azure Monitor diagnostic settings: no Log Analytics shared key involved.
  logs_destination = "azure-monitor"
  tags             = local.tags

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

resource "azurerm_monitor_diagnostic_setting" "container_apps" {
  name                       = "logs-to-workspace"
  target_resource_id         = azurerm_container_app_environment.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category_group = "allLogs"
  }
}
