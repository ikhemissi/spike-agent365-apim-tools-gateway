# How the optional parts of this project connect: the project's own file (not from a block), generated with the
# project's choices. Change it when the parts change; block files reference only the parts their block requires.

# The chat UI calls API Management with the user's own token for the model and for the MCP servers, and runs the tool
# loop itself.
locals {
  chat_ui_gateway = {
    env = {
      CHAT_GATEWAY  = "apim"
      GATEWAY_URL   = module.apim_ai_gateway.models_url
      GATEWAY_SCOPE = "${azuread_application_identifier_uri.apim_gateway.identifier_uri}/${local.apim_gateway_scope}"
      # The MCP servers registered in API Management (apim-mcp.tf).
      MCP_SERVERS = "notes=${module.apim_ai_gateway.gateway_url}/${local.apim_mcp_notes_path}"
    }
    key_vault_secrets = {}
    role_assignments  = {}
  }
}

locals {
  # Only API Management's identity may call the notes MCP server (external ingress, Entra tokens checked).
  notes_mcp_allowed_caller_id = module.apim_ai_gateway.principal_id
}
