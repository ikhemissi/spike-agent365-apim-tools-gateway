# Outputs become azd environment values (prefixed CHAT_UI_). No secrets.

output "CHAT_UI_URL" { value = "https://${azurerm_container_app.ui.ingress[0].fqdn}" }
output "CHAT_UI_APP_NAME" { value = azurerm_container_app.ui.name }
output "CHAT_UI_CLIENT_ID" { value = azuread_application.ui.client_id }
output "CHAT_UI_LITELLM_KEY_SECRET_NAME" { value = local.litellm_key_secret_name }
