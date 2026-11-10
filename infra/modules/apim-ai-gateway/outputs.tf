output "id" {
  value = azurerm_api_management.main.id
}

output "name" {
  value = azurerm_api_management.main.name
}

output "gateway_url" {
  value = azurerm_api_management.main.gateway_url
}

output "models_url" {
  value = "${azurerm_api_management.main.gateway_url}/openai/v1"
}

output "principal_id" {
  description = "The gateway's system-assigned identity, e.g. for an MCP server that only accepts the gateway."
  value       = azurerm_api_management.main.identity[0].principal_id
}
