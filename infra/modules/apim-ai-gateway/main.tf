# Azure API Management (Standard v2) as an AI gateway for signed-in users: the Foundry model's OpenAI-compatible v1 API
# (Responses, Chat Completions) under <gateway>/openai/v1, for callers with a user token for the gateway's app
# registration (policies/models.xml.tftpl), forwarded with the gateway's system-assigned identity ("Foundry User" on the
# account) and streamed unbuffered. Gateway logs go to Log Analytics. MCP servers are registered by the project (azapi;
# see the apim-gateway block's README).

data "azurerm_client_config" "current" {}

locals {
  # "Foundry User" (formerly "Azure AI User"): calls to any Foundry model, not only Azure OpenAI ones.
  foundry_user_role_id = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/53ca6127-db72-4b80-b1b0-d745d6d5456d"
}

resource "azurerm_api_management" "main" {
  name                = var.name
  location            = var.location
  resource_group_name = var.resource_group_name
  publisher_name      = var.publisher_name
  publisher_email     = var.publisher_email
  sku_name            = "StandardV2_1"
  tags                = var.tags

  identity {
    type = "SystemAssigned"
  }
}

resource "azurerm_role_assignment" "foundry_user" {
  scope              = var.foundry_account_id
  role_definition_id = local.foundry_user_role_id
  principal_id       = azurerm_api_management.main.identity[0].principal_id
  principal_type     = "ServicePrincipal"
}

resource "azurerm_monitor_diagnostic_setting" "gateway_logs" {
  name                       = "logs-to-workspace"
  target_resource_id         = azurerm_api_management.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "GatewayLogs"
  }
}

resource "azurerm_api_management_api" "models" {
  name                = "foundry-models"
  api_management_name = azurerm_api_management.main.name
  resource_group_name = var.resource_group_name
  revision            = "1"
  display_name        = "Foundry models (OpenAI v1)"
  path                = "openai/v1"
  protocols           = ["https"]
  service_url         = "${trimsuffix(var.foundry_openai_endpoint, "/")}/openai/v1"
  # Callers authenticate with their own Entra token, checked by the policy: no subscription keys.
  subscription_required = false
}

resource "azurerm_api_management_api_operation" "models" {
  for_each            = toset(["POST", "GET"])
  operation_id        = lower(each.key)
  api_name            = azurerm_api_management_api.models.name
  api_management_name = azurerm_api_management.main.name
  resource_group_name = var.resource_group_name
  display_name        = "${each.key} any model operation"
  method              = each.key
  url_template        = "/*"
}

resource "azurerm_api_management_api_policy" "models" {
  api_name            = azurerm_api_management_api.models.name
  api_management_name = azurerm_api_management.main.name
  resource_group_name = var.resource_group_name
  xml_content = templatefile("${path.module}/policies/models.xml.tftpl", {
    tenant_id = data.azurerm_client_config.current.tenant_id
    client_id = var.gateway_client_id
    scope     = var.gateway_scope
  })

  # The role must exist before the first call is forwarded with the gateway's identity.
  depends_on = [azurerm_role_assignment.foundry_user]
}
