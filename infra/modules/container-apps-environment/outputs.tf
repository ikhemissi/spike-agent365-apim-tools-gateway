output "id" {
  value = azurerm_container_app_environment.main.id
}

output "name" {
  value = azurerm_container_app_environment.main.name
}

# Lets an app know its own URL before it exists (https://<app name>.<default domain>).
output "default_domain" {
  value = azurerm_container_app_environment.main.default_domain
}
