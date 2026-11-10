# The chat UI (services/chat-ui, deployed by azd): a public container app where signed-in users chat with a model
# through a gateway, or with a Foundry hosted agent. What it talks to is set in connections.tf (local.chat_ui_gateway:
# the app's gateway settings, the Key Vault secrets it reads and the roles its identity needs). Who may use it is one
# Entra group, "<title> users (<environment>)": only its members can sign in (the app requires an app role assignment,
# given to the group). The deployer is a member; share the chat by adding people to the group (CHAT_USERS_GROUP_ID).
# Assigning a group to an application needs Microsoft Entra ID P1 or P2.

variable "chat_ui_image" {
  description = "The image azd deployed (SERVICE_CHAT_UI_IMAGE_NAME). Empty before the first deployment."
  type        = string
}

variable "chat_ui_title" {
  description = "The chat's title (CHAT_UI_TITLE); also names its app registration and its users' group."
  type        = string
}

variable "chat_ui_intro" {
  description = "What the page says under the title (CHAT_UI_INTRO). Empty: the app's default."
  type        = string
}

variable "chat_ui_instructions" {
  description = "The model's instructions in a gateway mode (CHAT_UI_INSTRUCTIONS). Empty: the app's generic prompt."
  type        = string
}

variable "chat_ui_litellm_key_secret_name" {
  description = "With LiteLLM: the Key Vault secret holding the chat's LiteLLM key (CHAT_UI_LITELLM_KEY_SECRET_NAME). Empty until the key exists (connections.tf)."
  type        = string
}

locals {
  chat_ui_name = "ca-chat-${local.token}"
  # Known before the app exists, so that the sign-in redirect and the app's own settings need no second pass.
  chat_ui_origin = "https://${local.chat_ui_name}.${module.container_apps_environment.default_domain}"
  chat_ui_scope  = "Chat.Use"
  # Optional settings are left out when empty, so that the app's defaults apply.
  chat_ui_optional_env = {
    for name, value in { CHAT_INTRO = var.chat_ui_intro, CHAT_INSTRUCTIONS = var.chat_ui_instructions } : name => value if value != ""
  }
}

resource "random_uuid" "chat_ui_scope" {}

resource "random_uuid" "chat_ui_user_role" {}

resource "azuread_group" "chat_users" {
  display_name     = "${var.chat_ui_title} users (${var.environment_name})"
  description      = "Who may use the ${var.chat_ui_title} chat of the ${var.environment_name} environment."
  security_enabled = true
  owners           = [data.azurerm_client_config.current.object_id]
}

# Only the deployer is managed here: members added later (portal, az ad group member add) are left as they are.
resource "azuread_group_member" "deployer" {
  group_object_id  = azuread_group.chat_users.object_id
  member_object_id = data.azurerm_client_config.current.object_id
}

# One app registration: the single-page application users sign in to, and the API scope its server checks.
resource "azuread_application" "chat_ui" {
  display_name     = "${var.chat_ui_title} (${var.environment_name})"
  sign_in_audience = "AzureADMyOrg"
  owners           = [data.azurerm_client_config.current.object_id]

  api {
    requested_access_token_version = 2

    oauth2_permission_scope {
      id                         = random_uuid.chat_ui_scope.result
      value                      = local.chat_ui_scope
      type                       = "User"
      enabled                    = true
      admin_consent_display_name = "Use the chat"
      admin_consent_description  = "Allows the chat to call its server on behalf of the signed-in user."
      user_consent_display_name  = "Use the chat"
      user_consent_description   = "Allows the chat to call its server on your behalf."
    }
  }

  app_role {
    id                   = random_uuid.chat_ui_user_role.result
    value                = "Chat.User"
    display_name         = "Chat user"
    description          = "May sign in to the chat."
    allowed_member_types = ["User"]
    enabled              = true
  }

  lifecycle {
    # The identifier URI and the redirect URIs are managed by their own resources below.
    ignore_changes = [identifier_uris, single_page_application]
  }
}

# api://<appId>: accepted by the tenant's default app management policy (custom URIs may be rejected).
resource "azuread_application_identifier_uri" "chat_ui" {
  application_id = azuread_application.chat_ui.id
  identifier_uri = "api://${azuread_application.chat_ui.client_id}"
}

resource "azuread_application_redirect_uris" "chat_ui" {
  application_id = azuread_application.chat_ui.id
  type           = "SPA"
  redirect_uris  = ["${local.chat_ui_origin}/auth/callback", "http://localhost:3000/auth/callback"]
}

resource "azuread_service_principal" "chat_ui" {
  client_id = azuread_application.chat_ui.client_id
  owners    = [data.azurerm_client_config.current.object_id]
  # Entra lets only users assigned to the app (the group's members) sign in.
  app_role_assignment_required = true
}

resource "azuread_app_role_assignment" "chat_users" {
  app_role_id         = random_uuid.chat_ui_user_role.result
  principal_object_id = azuread_group.chat_users.object_id
  resource_object_id  = azuread_service_principal.chat_ui.object_id
}

module "chat_ui" {
  source                                 = "./modules/container-app"
  name                                   = local.chat_ui_name
  azd_service_name                       = "chat-ui"
  image                                  = var.chat_ui_image
  port                                   = 3000
  health_path                            = "/api/health"
  external                               = true
  cpu                                    = 0.5
  memory                                 = "1Gi"
  resource_group_name                    = azurerm_resource_group.main.name
  location                               = var.location
  tags                                   = local.tags
  container_apps_environment_id          = module.container_apps_environment.id
  registry_server                        = module.container_registry.login_server
  registry_pull_identity_id              = module.container_registry.pull_identity_id
  application_insights_connection_string = module.monitoring.application_insights_connection_string
  key_vault_secrets                      = local.chat_ui_gateway.key_vault_secrets

  env = merge(
    {
      CHAT_MODEL   = module.foundry.model_deployment_name
      CHAT_TITLE   = var.chat_ui_title
      UI_TENANT_ID = data.azurerm_client_config.current.tenant_id
      UI_CLIENT_ID = azuread_application.chat_ui.client_id
      UI_SCOPE     = local.chat_ui_scope
      UI_ORIGIN    = local.chat_ui_origin
    },
    local.chat_ui_optional_env,
    local.chat_ui_gateway.env,
  )

  role_assignments = merge(
    { telemetry = { scope = module.monitoring.application_insights_id, role = "Monitoring Metrics Publisher" } },
    local.chat_ui_gateway.role_assignments,
  )
}

output "CHAT_UI_URL" { value = module.chat_ui.url }
output "CHAT_UI_CLIENT_ID" { value = azuread_application.chat_ui.client_id }
output "CHAT_USERS_GROUP_ID" { value = azuread_group.chat_users.object_id }
