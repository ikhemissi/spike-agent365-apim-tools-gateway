# The UI's container app. Until azd deploys the service it runs a placeholder image on port 80; the service's
# postdeploy hook (hooks/postdeploy.sh) provisions this layer again to switch to the app's port and add its probe.

locals {
  placeholder_image = "mcr.microsoft.com/k8se/quickstart:latest"
  image_deployed    = var.image != ""
  port              = 3000

  ui_env = {
    CHAT_GATEWAY            = local.gateway
    GATEWAY_URL             = local.gateway == "apim" ? var.apim_models_url : var.litellm_url
    CHAT_MODEL              = var.model
    UI_TENANT_ID            = data.azurerm_client_config.current.tenant_id
    UI_CLIENT_ID            = azuread_application.ui.client_id
    UI_SCOPE                = local.scope
    UI_ORIGIN               = local.origin
    ALLOWED_USER_OBJECT_IDS = data.azurerm_client_config.current.object_id
    # The identity that sends the app's telemetry (and reads the team key).
    AZURE_CLIENT_ID = azurerm_user_assigned_identity.ui.client_id
  }
  # Optional settings are left out when empty, so that the app's defaults apply. GATEWAY_SCOPE: the user's token for
  # the gateway goes with every chat request (LiteLLM's Agent 365 guardrail).
  optional_env = {
    for name, value in {
      CHAT_TITLE        = var.title
      CHAT_INTRO        = var.intro
      CHAT_INSTRUCTIONS = var.instructions
      GATEWAY_SCOPE     = local.gateway == "apim" ? var.apim_gateway_scope : var.gateway_scope
      MCP_SERVERS       = local.gateway == "apim" ? var.mcp_servers : ""
    } : name => value if value != ""
  }
}

resource "azurerm_container_app" "ui" {
  name                         = local.app_name
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.container_app_environment_id
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  # azd finds the app of the chat-ui service through this tag.
  tags = merge(local.tags, { "azd-service-name" = "chat-ui" })

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.ui.id, var.acr_pull_identity_id]
  }

  registry {
    server   = var.registry_server
    identity = var.acr_pull_identity_id
  }

  # With LiteLLM, the team's key, resolved from Key Vault by the app's identity: LiteLLM authenticates callers with
  # its own keys (LiteLLM OSS has no usable Entra authentication for callers). API Management takes the users' tokens.
  dynamic "secret" {
    for_each = local.uses_team_key ? [1] : []
    content {
      name                = "litellm-api-key"
      key_vault_secret_id = "${var.key_vault_uri}secrets/${local.litellm_key_secret_name}"
      identity            = azurerm_user_assigned_identity.ui.id
    }
  }

  ingress {
    external_enabled = true
    target_port      = local.image_deployed ? local.port : 80
    transport        = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "chat-ui"
      image  = local.image_deployed ? var.image : local.placeholder_image
      cpu    = 0.5
      memory = "1Gi"

      dynamic "env" {
        for_each = merge(local.ui_env, local.optional_env)
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.uses_team_key ? [1] : []
        content {
          name        = "LITELLM_API_KEY"
          secret_name = "litellm-api-key"
        }
      }

      # Turns OpenTelemetry on (instrumentation.ts). Outside the map above: Terraform marks it sensitive.
      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = var.application_insights_connection_string
      }

      dynamic "readiness_probe" {
        for_each = local.image_deployed ? [1] : []
        content {
          transport        = "HTTP"
          port             = local.port
          path             = "/api/health"
          interval_seconds = 10
        }
      }
    }
  }

  lifecycle {
    # azd deploy changes the image between two provisions; the next provision passes the same image back.
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [azurerm_role_assignment.ui_team_key, azurerm_role_assignment.ui_telemetry]
}
