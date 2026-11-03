# The Foundry model through the gateway: Foundry's OpenAI-compatible v1 API (Responses, Chat Completions) under
# <gateway>/openai/v1, for signed-in users only (policies/models.xml.tftpl).

resource "azurerm_api_management_api" "models" {
  name                = "foundry-models"
  api_management_name = azurerm_api_management.gateway.name
  resource_group_name = var.resource_group_name
  revision            = "1"
  display_name        = "Foundry models (OpenAI v1)"
  path                = "openai/v1"
  protocols           = ["https"]
  service_url         = "${trimsuffix(var.foundry_openai_endpoint, "/")}/openai/v1"
  # Callers authenticate with their own Entra token, checked by the policy: no subscription keys.
  subscription_required = false
}

resource "azurerm_api_management_api_operation" "models_post" {
  operation_id        = "post"
  api_name            = azurerm_api_management_api.models.name
  api_management_name = azurerm_api_management.gateway.name
  resource_group_name = var.resource_group_name
  display_name        = "POST any model operation"
  method              = "POST"
  url_template        = "/*"
}

resource "azurerm_api_management_api_operation" "models_get" {
  operation_id        = "get"
  api_name            = azurerm_api_management_api.models.name
  api_management_name = azurerm_api_management.gateway.name
  resource_group_name = var.resource_group_name
  display_name        = "GET any model operation"
  method              = "GET"
  url_template        = "/*"
}

resource "azurerm_api_management_api_policy" "models" {
  api_name            = azurerm_api_management_api.models.name
  api_management_name = azurerm_api_management.gateway.name
  resource_group_name = var.resource_group_name
  xml_content = templatefile("${path.module}/policies/models.xml.tftpl", {
    tenant_id = data.azurerm_client_config.current.tenant_id
    client_id = azuread_application.gateway.client_id
    scope     = local.scope
  })

  # The role must exist before the first call is forwarded with the gateway's identity.
  depends_on = [azurerm_role_assignment.gateway_foundry]
}
