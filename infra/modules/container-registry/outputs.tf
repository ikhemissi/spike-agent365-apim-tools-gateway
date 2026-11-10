output "id" {
  value = azurerm_container_registry.main.id
}

output "name" {
  value = azurerm_container_registry.main.name
}

output "login_server" {
  value = azurerm_container_registry.main.login_server
}

# Ready to pull: its AcrPull role is assigned.
output "pull_identity_id" {
  value      = azurerm_user_assigned_identity.pull.id
  depends_on = [azurerm_role_assignment.pull]
}
