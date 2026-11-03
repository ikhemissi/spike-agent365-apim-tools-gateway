# Outputs become azd environment values (prefixed APIM_). No secrets.

output "APIM_NAME" { value = azurerm_api_management.gateway.name }
output "APIM_GATEWAY_URL" { value = azurerm_api_management.gateway.gateway_url }
output "APIM_MODELS_URL" { value = "${azurerm_api_management.gateway.gateway_url}/openai/v1" }
output "APIM_PRINCIPAL_ID" { value = azurerm_api_management.gateway.identity[0].principal_id }
output "APIM_GATEWAY_CLIENT_ID" { value = azuread_application.gateway.client_id }
output "APIM_GATEWAY_SCOPE" { value = "api://${azuread_application.gateway.client_id}/${local.scope}" }
