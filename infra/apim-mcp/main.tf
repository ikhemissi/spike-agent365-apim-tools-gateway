# The spike's MCP servers in API Management: the notes MCP server (infra/notes-mcp) registered as an MCP API at
# <gateway>/notes. azurerm cannot create MCP APIs, hence azapi, the only use of it here. What works (checked on
# Standard v2): a backend with the server's full URL, and an API of type "mcp" pointing at it with backendId and the
# streamable transport, without endpoints. Agent 365 blocks it by setting the API's accessState; re-applying this
# layer keeps that state (the bodies below never set it), but replacing the API would lose it.

data "azapi_client_config" "current" {}

locals {
  service_id = "/subscriptions/${var.subscription_id}/resourceGroups/${var.resource_group_name}/providers/Microsoft.ApiManagement/service/${var.apim_name}"
  notes_path = "notes"
}

resource "azapi_resource" "notes_backend" {
  type      = "Microsoft.ApiManagement/service/backends@2024-06-01-preview"
  name      = "notes-mcp"
  parent_id = local.service_id
  body = {
    properties = {
      protocol = "http"
      url      = var.notes_mcp_url
      tls      = { validateCertificateChain = true, validateCertificateName = true }
      type     = "Single"
    }
  }
}

resource "azapi_resource" "notes_api" {
  type      = "Microsoft.ApiManagement/service/apis@2025-09-01-preview"
  name      = "notes"
  parent_id = local.service_id
  # Validation off: a pass-through MCP server needs backendId, which azapi's embedded schema for this API version
  # does not include yet (checked live).
  schema_validation_enabled = false
  body = {
    properties = {
      type                 = "mcp"
      displayName          = "Team notes"
      description          = "Read and add short team notes."
      path                 = local.notes_path
      protocols            = ["https"]
      backendId            = azapi_resource.notes_backend.name
      subscriptionRequired = false
      mcpProperties        = { transportType = "streamable" }
    }
  }
}

# Users of the tenant with the gateway's scope only, as for the model; then the notes server with the gateway's own
# identity (the only caller it accepts). Never read the response body here: it would break MCP streaming.
resource "azapi_resource" "notes_policy" {
  type      = "Microsoft.ApiManagement/service/apis/policies@2024-06-01-preview"
  name      = "policy"
  parent_id = azapi_resource.notes_api.id
  body = {
    properties = {
      format = "rawxml"
      value = templatefile("${path.module}/notes-policy.xml.tftpl", {
        tenant_id      = data.azapi_client_config.current.tenant_id
        client_id      = var.apim_gateway_client_id
        scope          = "Gateway.Use"
        notes_audience = var.notes_mcp_audience
      })
    }
  }
}
