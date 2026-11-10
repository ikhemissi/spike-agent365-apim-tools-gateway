output "log_analytics_workspace_id" {
  value = azurerm_log_analytics_workspace.main.id
}

output "application_insights_id" {
  value = azurerm_application_insights.main.id
}

output "application_insights_name" {
  value = azurerm_application_insights.main.name
}

# Locates the resource; not a credential, since ingestion needs an Entra token. Terraform marks it sensitive anyway.
output "application_insights_connection_string" {
  value     = azurerm_application_insights.main.connection_string
  sensitive = true
}
