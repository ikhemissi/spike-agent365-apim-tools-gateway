# The notes MCP server: a container app (services/notes-mcp, deployed by azd) exposing read tools and a write tool
# over MCP, for a gateway to call. Its notes are kept in a table of its own storage account, reached with its managed
# identity. Who can call it depends on the one allowed caller: NOTES_MCP_ALLOWED_CALLER_ID, or else the identity of an
# API Management gateway (APIM_PRINCIPAL_ID, when the project has the apim-gateway layer):
# - none: internal ingress only, reachable from the apps of the Container Apps environment (e.g. a LiteLLM gateway)
#   and from nowhere else, so callers need no token;
# - one: external ingress (API Management runs outside the environment), and the server accepts only Entra tokens
#   issued to that caller for its own app registration (services/notes-mcp/caller_auth.py).

data "azurerm_client_config" "current" {}

locals {
  token = substr(sha1("${var.subscription_id}-${var.environment_name}"), 0, 8)

  extra_tag_pairs = [for pair in split(",", var.tags) : split("=", pair) if trimspace(pair) != ""]
  extra_tags = {
    for pair in local.extra_tag_pairs : trimspace(pair[0]) => trimspace(join("=", slice(pair, 1, length(pair))))
  }
  tags = merge(local.extra_tags, { "azd-env-name" = var.environment_name })

  # Until azd deploys the service, the app runs a placeholder image listening on port 80; the postdeploy hook of the
  # service provisions this layer again to switch to the real port and add the health probes.
  placeholder_image = "mcr.microsoft.com/k8se/quickstart:latest"
  image_deployed    = var.image != ""
  port              = 8080

  allowed_caller_id = coalesce(var.allowed_caller_id, var.apim_principal_id, "none")
  entra_only        = local.allowed_caller_id != "none"
  # The settings of the caller check, only when one caller is allowed.
  caller_check_env = local.entra_only ? {
    NOTES_AUTH_TENANT_ID    = data.azurerm_client_config.current.tenant_id
    NOTES_AUTH_AUDIENCE     = azuread_application_identifier_uri.notes[0].identifier_uri
    NOTES_ALLOWED_CALLER_ID = local.allowed_caller_id
  } : {}
}

# The server's own app registration: the audience of the tokens its one caller gets. No scopes or roles: the server
# checks who the caller is (its object id), so no permission needs granting.
resource "azuread_application" "notes" {
  count            = local.entra_only ? 1 : 0
  display_name     = "Notes MCP (${var.environment_name})"
  sign_in_audience = "AzureADMyOrg"
  owners           = [data.azurerm_client_config.current.object_id]

  lifecycle {
    ignore_changes = [identifier_uris]
  }
}

# api://<appId>: accepted by the tenant's default app management policy (custom URIs may be rejected).
resource "azuread_application_identifier_uri" "notes" {
  count          = local.entra_only ? 1 : 0
  application_id = azuread_application.notes[0].id
  identifier_uri = "api://${azuread_application.notes[0].client_id}"
}

# Entra issues tokens only for an application that has a service principal in the tenant.
resource "azuread_service_principal" "notes" {
  count     = local.entra_only ? 1 : 0
  client_id = azuread_application.notes[0].client_id
  owners    = [data.azurerm_client_config.current.object_id]
}

resource "azurerm_storage_account" "notes" {
  name                            = "stnotes${local.token}"
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  min_tls_version                 = "TLS1_2"
  public_network_access_enabled   = true
  tags                            = local.tags
}

resource "azurerm_user_assigned_identity" "notes" {
  name                = "id-notes-mcp-${local.token}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_role_assignment" "notes_table" {
  scope                = azurerm_storage_account.notes.id
  role_definition_name = "Storage Table Data Contributor"
  principal_id         = azurerm_user_assigned_identity.notes.principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_container_app" "notes" {
  name                         = "ca-notes-mcp-${local.token}"
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.container_app_environment_id
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  # azd finds the app of the notes-mcp service through this tag.
  tags = merge(local.tags, { "azd-service-name" = "notes-mcp" })

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.notes.id, var.acr_pull_identity_id]
  }

  registry {
    server   = var.registry_server
    identity = var.acr_pull_identity_id
  }

  ingress {
    external_enabled = local.entra_only
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
      name   = "notes-mcp"
      image  = local.image_deployed ? var.image : local.placeholder_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.notes.client_id
      }

      env {
        name  = "NOTES_TABLE_ENDPOINT"
        value = azurerm_storage_account.notes.primary_table_endpoint
      }

      dynamic "env" {
        for_each = local.caller_check_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "readiness_probe" {
        for_each = local.image_deployed ? [1] : []
        content {
          transport        = "HTTP"
          port             = local.port
          path             = "/health"
          interval_seconds = 10
        }
      }
    }
  }

  lifecycle {
    # azd deploy changes the image between two provisions; the next provision passes the same image back.
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [azurerm_role_assignment.notes_table]
}
