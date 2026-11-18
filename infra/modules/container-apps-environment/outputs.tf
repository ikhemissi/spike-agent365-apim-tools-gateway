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

# With a subnet, the address apps with TCP ingress are reached at (in that subnet when internal).
output "static_ip_address" {
  value = azurerm_container_app_environment.main.static_ip_address
}
