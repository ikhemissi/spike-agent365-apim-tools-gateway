# Outputs become azd environment values (prefixed NOTES_MCP_). With internal ingress the URL resolves only inside the
# Container Apps environment; NOTES_MCP_AUDIENCE is empty then.

output "NOTES_MCP_APP_NAME" { value = azurerm_container_app.notes.name }
output "NOTES_MCP_URL" { value = "https://${azurerm_container_app.notes.ingress[0].fqdn}/mcp" }
output "NOTES_MCP_STORAGE_NAME" { value = azurerm_storage_account.notes.name }
output "NOTES_MCP_AUDIENCE" { value = local.entra_only ? azuread_application_identifier_uri.notes[0].identifier_uri : "" }
