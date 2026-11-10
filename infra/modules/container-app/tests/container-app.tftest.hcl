# Before azd deploys the service: a placeholder image on port 80, no probe. After: the service's image, port and probe.

mock_provider "azurerm" {}

variables {
  name                          = "ca-test"
  resource_group_name           = "rg-test"
  location                      = "francecentral"
  container_apps_environment_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.App/managedEnvironments/cae-test"
  registry_server               = "crtest.azurecr.io"
  registry_pull_identity_id     = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-crtest-pull"
  azd_service_name              = "test-service"
  port                          = 8080
}

run "before_the_first_deployment" {
  command = plan

  assert {
    condition     = azurerm_container_app.main.ingress[0].target_port == 80
    error_message = "The placeholder image listens on port 80."
  }
  assert {
    condition     = length(azurerm_container_app.main.template[0].container[0].readiness_probe) == 0
    error_message = "No probe on the placeholder."
  }
  assert {
    condition     = azurerm_container_app.main.tags["azd-service-name"] == "test-service"
    error_message = "azd finds the app through its service tag."
  }
}

run "after_the_first_deployment" {
  command = plan

  variables {
    image                                  = "crtest.azurecr.io/test-service:1"
    application_insights_connection_string = "InstrumentationKey=00000000-0000-0000-0000-000000000002"
  }

  assert {
    condition     = azurerm_container_app.main.ingress[0].target_port == 8080
    error_message = "The service's port once its image is deployed."
  }
  assert {
    condition     = azurerm_container_app.main.template[0].container[0].readiness_probe[0].path == "/health"
    error_message = "The readiness probe on the service's health path."
  }
  assert {
    condition     = contains([for env in azurerm_container_app.main.template[0].container[0].env : env.name], "APPLICATIONINSIGHTS_CONNECTION_STRING")
    error_message = "Telemetry is configured when a connection string is given."
  }
}

run "a_secret_from_key_vault" {
  command = plan

  variables {
    key_vault_secrets = { LITELLM_API_KEY = "https://kv-test.vault.azure.net/secrets/litellm-key-chat-ui" }
  }

  assert {
    condition     = one(azurerm_container_app.main.secret).key_vault_secret_id == "https://kv-test.vault.azure.net/secrets/litellm-key-chat-ui"
    error_message = "The secret is a Key Vault reference, not a value."
  }
  assert {
    condition     = one([for env in azurerm_container_app.main.template[0].container[0].env : env.secret_name if env.name == "LITELLM_API_KEY"]) == "litellm-api-key"
    error_message = "The variable reads the app's secret."
  }
}

