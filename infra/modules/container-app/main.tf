# A container app for a service that azd builds and deploys (azure.yaml), with its own user-assigned identity and the
# roles that identity needs, assigned before the app starts. AZURE_CLIENT_ID tells the app which identity to use.
#
# Until azd deploys the service, the app runs a placeholder image listening on port 80. After the first deployment,
# the project's postdeploy hook provisions again, now with the service's image: the app switches to its port and gets
# its health probe.

locals {
  placeholder_image = "mcr.microsoft.com/k8se/quickstart:latest"
  image_deployed    = var.image != ""
  # Whether a connection string was given is not secret, unlike the string itself (which Terraform marks sensitive).
  sends_telemetry = nonsensitive(var.application_insights_connection_string != null)
}

resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

resource "azurerm_role_assignment" "app" {
  for_each             = var.role_assignments
  scope                = each.value.scope
  role_definition_name = each.value.role
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_container_app" "main" {
  name                         = var.name
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.container_apps_environment_id
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  # azd finds the app of a service through this tag.
  tags = merge(var.tags, { "azd-service-name" = var.azd_service_name })

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id, var.registry_pull_identity_id]
  }

  registry {
    server   = var.registry_server
    identity = var.registry_pull_identity_id
  }

  # Secrets the app cannot avoid (e.g. a gateway key), resolved from Key Vault by the app's identity.
  dynamic "secret" {
    for_each = var.key_vault_secrets
    content {
      name                = lower(replace(secret.key, "_", "-"))
      key_vault_secret_id = secret.value
      identity            = azurerm_user_assigned_identity.app.id
    }
  }

  ingress {
    external_enabled = var.external
    target_port      = local.image_deployed ? var.port : 80
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
      name   = var.azd_service_name
      image  = local.image_deployed ? var.image : local.placeholder_image
      cpu    = var.cpu
      memory = var.memory

      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.app.client_id
      }

      dynamic "env" {
        for_each = var.env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.key_vault_secrets
        content {
          name        = env.key
          secret_name = lower(replace(env.key, "_", "-"))
        }
      }

      dynamic "env" {
        for_each = local.sends_telemetry ? [1] : []
        content {
          name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
          value = var.application_insights_connection_string
        }
      }

      dynamic "readiness_probe" {
        for_each = local.image_deployed ? [1] : []
        content {
          transport        = "HTTP"
          port             = var.port
          path             = var.health_path
          interval_seconds = 10
        }
      }
    }
  }

  lifecycle {
    # azd deploy changes the image between two provisions; the next provision passes the same image back.
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [azurerm_role_assignment.app]
}
