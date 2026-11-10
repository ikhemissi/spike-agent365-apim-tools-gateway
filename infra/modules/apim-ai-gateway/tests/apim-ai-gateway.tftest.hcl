# The gateway takes users' tokens (no subscription keys) and calls Foundry with its own identity.

mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      tenant_id       = "00000000-0000-0000-0000-000000000001"
      subscription_id = "00000000-0000-0000-0000-000000000002"
    }
  }
}

variables {
  name                       = "apim-test"
  resource_group_name        = "rg-test"
  location                   = "francecentral"
  publisher_name             = "AI gateway (test)"
  publisher_email            = "owner@example.com"
  foundry_account_id         = "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-test/providers/Microsoft.CognitiveServices/accounts/ais-test"
  foundry_openai_endpoint    = "https://ais-test.openai.azure.com/"
  log_analytics_workspace_id = "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-test/providers/Microsoft.OperationalInsights/workspaces/log-test"
  gateway_client_id          = "00000000-0000-0000-0000-000000000003"
  gateway_scope              = "Gateway.Use"
}

run "users_tokens_and_the_gateways_identity" {
  command = plan

  assert {
    condition     = azurerm_api_management_api.models.subscription_required == false
    error_message = "Callers authenticate with their Entra token, not a subscription key."
  }
  assert {
    condition     = azurerm_api_management_api.models.service_url == "https://ais-test.openai.azure.com/openai/v1"
    error_message = "The model API forwards to Foundry's OpenAI v1 API."
  }
  assert {
    condition     = strcontains(azurerm_api_management_api_policy.models.xml_content, "<value>Gateway.Use</value>") && strcontains(azurerm_api_management_api_policy.models.xml_content, "authentication-managed-identity")
    error_message = "The policy checks the user's scope, then calls Foundry with the gateway's identity."
  }
  assert {
    condition     = endswith(azurerm_role_assignment.foundry_user.role_definition_id, "53ca6127-db72-4b80-b1b0-d745d6d5456d")
    error_message = "The gateway's identity is a Foundry User on the account."
  }
}
