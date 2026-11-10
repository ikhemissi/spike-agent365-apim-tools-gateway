# Azure API Management (Standard v2, about $1 an hour) as an AI and MCP gateway (modules/apim-ai-gateway). Callers are
# users: an app signs its user in and calls the gateway with the user's token for this app registration (scope
# Gateway.Use, APIM_GATEWAY_SCOPE); the Azure CLI is pre-authorized, so scripts can act as the signed-in user. The
# gateway calls the Foundry model with its own identity. MCP servers are registered by the project (README of the
# apim-gateway block): give the gateway's identity (APIM_PRINCIPAL_ID) access to each server.

locals {
  apim_gateway_scope = "Gateway.Use"
  apim_azure_cli_id  = "04b07795-8ddb-461a-bbee-02f9e1bf7b46"
}

# API Management sends its service notifications to the deployer.
data "azuread_user" "apim_publisher" {
  object_id = data.azurerm_client_config.current.object_id
}

resource "random_uuid" "apim_gateway_scope" {}

resource "azuread_application" "apim_gateway" {
  display_name     = "API Management AI gateway (${var.environment_name})"
  sign_in_audience = "AzureADMyOrg"
  owners           = [data.azurerm_client_config.current.object_id]

  api {
    requested_access_token_version = 2

    oauth2_permission_scope {
      id                         = random_uuid.apim_gateway_scope.result
      value                      = local.apim_gateway_scope
      type                       = "User"
      enabled                    = true
      admin_consent_display_name = "Use the AI gateway"
      admin_consent_description  = "Allows the app to call models and tools through the AI gateway as the signed-in user."
      user_consent_display_name  = "Use the AI gateway"
      user_consent_description   = "Allows the app to call models and tools through the AI gateway on your behalf."
    }
  }

  lifecycle {
    ignore_changes = [identifier_uris, required_resource_access]
  }
}

resource "azuread_application_identifier_uri" "apim_gateway" {
  application_id = azuread_application.apim_gateway.id
  identifier_uri = "api://${azuread_application.apim_gateway.client_id}"
}

resource "azuread_application_pre_authorized" "apim_azure_cli" {
  application_id       = azuread_application.apim_gateway.id
  authorized_client_id = local.apim_azure_cli_id
  permission_ids       = [random_uuid.apim_gateway_scope.result]
}

resource "azuread_service_principal" "apim_gateway" {
  client_id = azuread_application.apim_gateway.client_id
  owners    = [data.azurerm_client_config.current.object_id]
}

module "apim_ai_gateway" {
  source                     = "./modules/apim-ai-gateway"
  name                       = "apim-${var.environment_name}-${local.token}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = var.location
  tags                       = local.tags
  publisher_name             = "AI gateway (${var.environment_name})"
  publisher_email            = data.azuread_user.apim_publisher.user_principal_name
  foundry_account_id         = module.foundry.account_id
  foundry_openai_endpoint    = module.foundry.openai_endpoint
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  gateway_client_id          = azuread_application.apim_gateway.client_id
  gateway_scope              = local.apim_gateway_scope
}

output "APIM_NAME" { value = module.apim_ai_gateway.name }
output "APIM_GATEWAY_URL" { value = module.apim_ai_gateway.gateway_url }
output "APIM_MODELS_URL" { value = module.apim_ai_gateway.models_url }
output "APIM_PRINCIPAL_ID" { value = module.apim_ai_gateway.principal_id }
output "APIM_GATEWAY_CLIENT_ID" { value = azuread_application.apim_gateway.client_id }
output "APIM_GATEWAY_SCOPE" { value = "${azuread_application_identifier_uri.apim_gateway.identifier_uri}/${local.apim_gateway_scope}" }
