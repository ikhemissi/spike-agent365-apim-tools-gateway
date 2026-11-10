# Logs and traces of every part: Log Analytics and Application Insights, which accept only Entra-authenticated
# telemetry (each sender gets the Monitoring Metrics Publisher role).

module "monitoring" {
  source                    = "./modules/monitoring"
  resource_group_name       = azurerm_resource_group.main.name
  location                  = var.location
  tags                      = local.tags
  log_analytics_name        = "log-${var.environment_name}-${local.token}"
  application_insights_name = "appi-${var.environment_name}-${local.token}"
}

output "APPLICATION_INSIGHTS_ID" { value = module.monitoring.application_insights_id }
output "APPLICATIONINSIGHTS_CONNECTION_STRING" {
  value     = module.monitoring.application_insights_connection_string
  sensitive = true
}
