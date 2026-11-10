# A Container Apps environment (Consumption workload profile) whose logs go to Log Analytics through a diagnostic
# setting: no Log Analytics shared key involved. Given a subnet (delegated to Microsoft.App/environments, /27 or
# larger), the environment joins that virtual network.

resource "azurerm_container_app_environment" "main" {
  name                     = var.name
  resource_group_name      = var.resource_group_name
  location                 = var.location
  logs_destination         = "azure-monitor"
  infrastructure_subnet_id = var.subnet_id
  tags                     = var.tags

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

resource "azurerm_monitor_diagnostic_setting" "logs" {
  name                       = "logs-to-workspace"
  target_resource_id         = azurerm_container_app_environment.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category_group = "allLogs"
  }
}
