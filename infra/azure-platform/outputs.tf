# Outputs become azd environment values, read by the workload layers (their main.tfvars.json), the hooks and azd
# deploy. azd's own names (AZURE_*) as azd expects them; the others prefixed with PLATFORM_. No secrets.

output "AZURE_RESOURCE_GROUP" { value = azurerm_resource_group.main.name }
output "AZURE_LOCATION" { value = var.location }
output "AZURE_TENANT_ID" { value = data.azurerm_client_config.current.tenant_id }

# azd deploy builds images remotely in this registry (remoteBuild) and pushes them there.
output "AZURE_CONTAINER_REGISTRY_ENDPOINT" { value = azurerm_container_registry.main.login_server }
output "AZURE_CONTAINER_REGISTRY_NAME" { value = azurerm_container_registry.main.name }
output "AZURE_CONTAINER_APPS_ENVIRONMENT_NAME" { value = azurerm_container_app_environment.main.name }
output "AZURE_CONTAINER_APPS_ENVIRONMENT_ID" { value = azurerm_container_app_environment.main.id }
output "PLATFORM_CONTAINER_APPS_DEFAULT_DOMAIN" { value = azurerm_container_app_environment.main.default_domain }

output "PLATFORM_LOG_ANALYTICS_WORKSPACE_ID" { value = azurerm_log_analytics_workspace.main.id }
output "PLATFORM_APPLICATION_INSIGHTS_ID" { value = azurerm_application_insights.main.id }
output "PLATFORM_APPLICATION_INSIGHTS_NAME" { value = azurerm_application_insights.main.name }
# With local authentication disabled the connection string only locates the resource; ingestion requires Entra.
output "PLATFORM_APPLICATION_INSIGHTS_CONNECTION_STRING" {
  value     = azurerm_application_insights.main.connection_string
  sensitive = true
}
output "PLATFORM_KEY_VAULT_ID" { value = azurerm_key_vault.main.id }
output "PLATFORM_KEY_VAULT_NAME" { value = azurerm_key_vault.main.name }
output "PLATFORM_KEY_VAULT_URI" { value = azurerm_key_vault.main.vault_uri }
output "PLATFORM_ACR_PULL_IDENTITY_ID" { value = azurerm_user_assigned_identity.acr_pull.id }
