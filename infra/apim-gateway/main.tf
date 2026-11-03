# API Management gateway layer: an API Management instance (Standard v2) in front of the Foundry model and of MCP
# servers. Callers present their own Entra token for the gateway's app registration (scope Gateway.Use), so every call
# names a user and no key is handed out; the gateway calls Foundry with its own managed identity ("Foundry User").
# MCP servers are registered by the project (each needs its backend URL and how the gateway signs in to it).

data "azurerm_client_config" "current" {}

data "azuread_user" "deployer" {
  object_id = data.azurerm_client_config.current.object_id
}

locals {
  token = substr(sha1("${var.subscription_id}-${var.environment_name}"), 0, 8)

  extra_tag_pairs = [for pair in split(",", var.tags) : split("=", pair) if trimspace(pair) != ""]
  extra_tags = {
    for pair in local.extra_tag_pairs : trimspace(pair[0]) => trimspace(join("=", slice(pair, 1, length(pair))))
  }
  tags = merge(local.extra_tags, { "azd-env-name" = var.environment_name })

  apim_name = "apim-${var.environment_name}-${local.token}"
  scope     = "Gateway.Use"
  # The Azure CLI may ask for a user's gateway token without a consent prompt, for scripts that act as the user.
  azure_cli_app_id = "04b07795-8ddb-461a-bbee-02f9e1bf7b46"
  # "Foundry User" (formerly "Azure AI User"): calls to any Foundry model, not only Azure OpenAI ones.
  foundry_user_role_id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/53ca6127-db72-4b80-b1b0-d745d6d5456d"
}

resource "random_uuid" "gateway_scope" {}

# The audience of the users' tokens: callers ask for api://<appId>/Gateway.Use with their own sign-in.
resource "azuread_application" "gateway" {
  display_name     = "AI gateway (${var.environment_name})"
  sign_in_audience = "AzureADMyOrg"
  owners           = [data.azurerm_client_config.current.object_id]

  api {
    requested_access_token_version = 2

    oauth2_permission_scope {
      id                         = random_uuid.gateway_scope.result
      value                      = local.scope
      type                       = "User"
      enabled                    = true
      admin_consent_display_name = "Use the AI gateway"
      admin_consent_description  = "Allows the app to call models and tools through the AI gateway as the signed-in user."
      user_consent_display_name  = "Use the AI gateway"
      user_consent_description   = "Allows the app to call models and tools through the AI gateway on your behalf."
    }
  }

  lifecycle {
    # The identifier URI is managed by its own resource below.
    ignore_changes = [identifier_uris]
  }
}

# api://<appId>: accepted by the tenant's default app management policy (custom URIs may be rejected).
resource "azuread_application_identifier_uri" "gateway" {
  application_id = azuread_application.gateway.id
  identifier_uri = "api://${azuread_application.gateway.client_id}"
}

resource "azuread_application_pre_authorized" "azure_cli" {
  application_id       = azuread_application.gateway.id
  authorized_client_id = local.azure_cli_app_id
  permission_ids       = [random_uuid.gateway_scope.result]
}

resource "azuread_service_principal" "gateway" {
  client_id = azuread_application.gateway.client_id
  owners    = [data.azurerm_client_config.current.object_id]
}

resource "azurerm_api_management" "gateway" {
  name                = local.apim_name
  location            = var.location
  resource_group_name = var.resource_group_name
  publisher_name      = "AI gateway (${var.environment_name})"
  publisher_email     = data.azuread_user.deployer.user_principal_name
  sku_name            = "StandardV2_1"
  tags                = local.tags

  identity {
    type = "SystemAssigned"
  }
}

resource "azurerm_role_assignment" "gateway_foundry" {
  scope              = var.foundry_account_id
  role_definition_id = local.foundry_user_role_id
  principal_id       = azurerm_api_management.gateway.identity[0].principal_id
  principal_type     = "ServicePrincipal"
}

# Gateway logs (each call: API, operation, status, duration, caller IP) to the platform's Log Analytics workspace.
resource "azurerm_monitor_diagnostic_setting" "gateway" {
  name                       = "logs-to-workspace"
  target_resource_id         = azurerm_api_management.gateway.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "GatewayLogs"
  }
}
