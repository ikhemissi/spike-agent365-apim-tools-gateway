output "name" {
  value = azurerm_container_app.main.name
}

output "url" {
  value = "https://${azurerm_container_app.main.ingress[0].fqdn}"
}

output "identity_principal_id" {
  value = azurerm_user_assigned_identity.app.principal_id
}

output "identity_client_id" {
  value = azurerm_user_assigned_identity.app.client_id
}
