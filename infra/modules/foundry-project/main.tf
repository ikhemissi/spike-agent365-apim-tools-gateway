# A Microsoft Foundry account (AI Services, key-based access disabled), one project, one chat model deployment, and
# the project's connection to Application Insights (tracing and evaluations in the Foundry portal). Callers use the
# model with an Entra identity and the "Foundry User" role on the account. Given a private endpoint subnet, the
# account also gets a private endpoint (hosted agents inside a virtual network need more, not covered here).

data "azurerm_client_config" "current" {}

locals {
  api_version = "2025-06-01"
  # Built rather than read: a data source would fail on `azd down`, after the predown hook deleted the group.
  resource_group_id = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/resourceGroups/${var.resource_group_name}"
}

resource "azapi_resource" "account" {
  type      = "Microsoft.CognitiveServices/accounts@${local.api_version}"
  name      = var.account_name
  parent_id = local.resource_group_id
  location  = var.location
  tags      = var.tags

  identity {
    type = "SystemAssigned"
  }

  body = {
    kind = "AIServices"
    sku  = { name = "S0" }
    properties = {
      allowProjectManagement = true
      customSubDomainName    = var.account_name
      disableLocalAuth       = true
      publicNetworkAccess    = var.public_network_access_enabled ? "Enabled" : "Disabled"
    }
  }
}

resource "azapi_resource" "project" {
  type      = "Microsoft.CognitiveServices/accounts/projects@${local.api_version}"
  name      = var.project_name
  parent_id = azapi_resource.account.id
  location  = var.location
  tags      = var.tags

  identity {
    type = "SystemAssigned"
  }

  body = {
    properties = {
      displayName = var.project_name
    }
  }

  response_export_values = ["identity.principalId"]
}

resource "azapi_resource" "model" {
  type = "Microsoft.CognitiveServices/accounts/deployments@${local.api_version}"
  # Deployment names must not contain the reserved word "Microsoft".
  name      = var.model.name
  parent_id = azapi_resource.account.id

  body = {
    sku = {
      name     = var.model.sku
      capacity = var.model.capacity
    }
    properties = {
      model = {
        format  = "OpenAI"
        name    = var.model.name
        version = var.model.version
      }
      versionUpgradeOption = "NoAutoUpgrade"
      raiPolicyName        = "Microsoft.DefaultV2"
    }
  }

  # Concurrent operations on the same account fail with a conflict.
  depends_on = [azapi_resource.project]
}

# Documented Foundry form: the "key" is the ingestion connection string, an endpoint identifier rather than a
# credential; with local authentication disabled on Application Insights, ingestion still requires an Entra token.
resource "azapi_resource" "appinsights_connection" {
  type      = "Microsoft.CognitiveServices/accounts/projects/connections@${local.api_version}"
  name      = "appinsights"
  parent_id = azapi_resource.project.id

  body = {
    properties = {
      category = "AppInsights"
      target   = var.application_insights_id
      authType = "ApiKey"
      # The service stores false for this category regardless of the request (true would drift on every plan).
      isSharedToAll = false
      credentials   = { key = var.application_insights_connection_string }
      metadata = {
        ApiType    = "Azure"
        ResourceId = var.application_insights_id
      }
    }
  }

  depends_on = [azapi_resource.model]
}

# Lets the Foundry portal (tracing, evaluations) read the traces, including GenAI content.
resource "azurerm_role_assignment" "project_traces" {
  for_each             = toset(["Log Analytics Reader", "Privileged Monitoring Data Reader"])
  scope                = var.application_insights_id
  role_definition_name = each.value
  principal_id         = azapi_resource.project.output.identity.principalId
  principal_type       = "ServicePrincipal"
}

resource "azurerm_private_endpoint" "main" {
  count               = var.private_endpoint_subnet_id == null ? 0 : 1
  name                = "pe-${var.account_name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoint_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = var.account_name
    private_connection_resource_id = azapi_resource.account.id
    subresource_names              = ["account"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name = "default"
    private_dns_zone_ids = [
      var.private_dns_zone_ids["privatelink.cognitiveservices.azure.com"],
      var.private_dns_zone_ids["privatelink.openai.azure.com"],
      var.private_dns_zone_ids["privatelink.services.ai.azure.com"],
    ]
  }

  depends_on = [azapi_resource.appinsights_connection]
}
