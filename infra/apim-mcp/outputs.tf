# Outputs become azd environment values. CHAT_UI_MCP_SERVERS is what the chat UI calls through the gateway.

output "APIM_MCP_NOTES_URL" { value = "${var.apim_gateway_url}/${local.notes_path}" }
output "APIM_MCP_LEARN_URL" { value = "${var.apim_gateway_url}/${local.learn_path}" }
output "CHAT_UI_MCP_SERVERS" { value = "notes=${var.apim_gateway_url}/${local.notes_path}" }
