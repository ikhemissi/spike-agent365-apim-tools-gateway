# The spike's MCP servers in API Management (azapi: azurerm cannot create MCP APIs): the notes MCP server (which only
# accepts the gateway's identity) and Microsoft Learn's MCP server, each behind a policy that requires a signed-in
# user's token for the gateway (policies/mcp-policy.xml.tftpl). Agent 365 discovers and governs them per server.

locals {
  apim_mcp_notes_path = "notes"
  apim_mcp_learn_path = "learn"
}

resource "azapi_resource" "notes_backend" {
  type      = "Microsoft.ApiManagement/service/backends@2024-06-01-preview"
  name      = "notes-mcp"
  parent_id = module.apim_ai_gateway.id
  body = {
    properties = {
      protocol = "http"
      url      = "${module.notes_mcp.url}/mcp"
      tls      = { validateCertificateChain = true, validateCertificateName = true }
      type     = "Single"
    }
  }
}

resource "azapi_resource" "notes_api" {
  type      = "Microsoft.ApiManagement/service/apis@2025-09-01-preview"
  name      = "notes"
  parent_id = module.apim_ai_gateway.id
  # azapi's schema for this preview API version lacks backendId.
  schema_validation_enabled = false
  body = {
    properties = {
      type                 = "mcp"
      displayName          = "Team notes"
      description          = "Read and add short team notes (changed while blocked, experiment 05)."
      path                 = local.apim_mcp_notes_path
      protocols            = ["https"]
      backendId            = azapi_resource.notes_backend.name
      subscriptionRequired = false
      mcpProperties        = { transportType = "streamable" }
    }
  }
}

resource "azapi_resource" "notes_policy" {
  type      = "Microsoft.ApiManagement/service/apis/policies@2024-06-01-preview"
  name      = "policy"
  parent_id = azapi_resource.notes_api.id
  body = {
    properties = {
      format = "rawxml"
      value = templatefile("${path.module}/policies/mcp-policy.xml.tftpl", {
        tenant_id        = data.azurerm_client_config.current.tenant_id
        client_id        = azuread_application.apim_gateway.client_id
        scope            = local.apim_gateway_scope
        backend_audience = coalesce(one(azuread_application_identifier_uri.notes_mcp[*].identifier_uri), "")
      })
    }
  }
}

resource "azapi_resource" "learn_backend" {
  type      = "Microsoft.ApiManagement/service/backends@2024-06-01-preview"
  name      = "learn-mcp"
  parent_id = module.apim_ai_gateway.id
  body = {
    properties = {
      protocol = "http"
      url      = "https://learn.microsoft.com/api/mcp"
      tls      = { validateCertificateChain = true, validateCertificateName = true }
      type     = "Single"
    }
  }
}

resource "azapi_resource" "learn_api" {
  type                      = "Microsoft.ApiManagement/service/apis@2025-09-01-preview"
  name                      = "learn"
  parent_id                 = module.apim_ai_gateway.id
  schema_validation_enabled = false # backendId, as for the notes API
  body = {
    properties = {
      type                 = "mcp"
      displayName          = "Microsoft Learn docs"
      description          = "Search and read Microsoft's documentation."
      path                 = local.apim_mcp_learn_path
      protocols            = ["https"]
      backendId            = azapi_resource.learn_backend.name
      subscriptionRequired = false
      mcpProperties        = { transportType = "streamable" }
    }
  }
}

resource "azapi_resource" "learn_policy" {
  type      = "Microsoft.ApiManagement/service/apis/policies@2024-06-01-preview"
  name      = "policy"
  parent_id = azapi_resource.learn_api.id
  body = {
    properties = {
      format = "rawxml"
      value = templatefile("${path.module}/policies/mcp-policy.xml.tftpl", {
        tenant_id        = data.azurerm_client_config.current.tenant_id
        client_id        = azuread_application.apim_gateway.client_id
        scope            = local.apim_gateway_scope
        backend_audience = ""
      })
    }
  }
}

output "APIM_MCP_NOTES_URL" { value = "${module.apim_ai_gateway.gateway_url}/${local.apim_mcp_notes_path}" }
output "APIM_MCP_LEARN_URL" { value = "${module.apim_ai_gateway.gateway_url}/${local.apim_mcp_learn_path}" }
