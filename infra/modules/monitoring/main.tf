# Log Analytics workspace and the workspace-based Application Insights that apps and agents send telemetry to.
# Local authentication is off: telemetry is accepted only with an Entra token (Monitoring Metrics Publisher role).

resource "azurerm_log_analytics_workspace" "main" {
  name                = var.log_analytics_name
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = var.retention_in_days
  tags                = var.tags
}

resource "azurerm_application_insights" "main" {
  name                         = var.application_insights_name
  resource_group_name          = var.resource_group_name
  location                     = var.location
  workspace_id                 = azurerm_log_analytics_workspace.main.id
  application_type             = "other"
  local_authentication_enabled = false
  tags                         = var.tags
}
