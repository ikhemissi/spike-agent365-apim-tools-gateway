# Where the project's container apps run (gateways, MCP servers, UIs), with their logs in Log Analytics.

module "container_apps_environment" {
  source                     = "./modules/container-apps-environment"
  name                       = "cae-${var.environment_name}-${local.token}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = var.location
  tags                       = local.tags
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  subnet_id                  = lookup(local.network.subnet_ids, "container-apps", null)
}
