# Microsoft Foundry layer: an AI Services account with key-based access disabled, a project, one chat model deployment
# and the project's Application Insights connection (tracing and evaluations in the Foundry portal). Workloads call the
# model with their managed identity and the "Foundry User" role on the account (FOUNDRY_ACCOUNT_ID).

data "azurerm_client_config" "current" {}

locals {
  token = substr(sha1("${var.subscription_id}-${var.environment_name}"), 0, 8)
  # Built from its name rather than read: `azd down` destroys the layers after the predown hook deleted the group,
  # and a data source reading a deleted resource fails the destroy.
  resource_group_id = "/subscriptions/${var.subscription_id}/resourceGroups/${var.resource_group_name}"

  extra_tag_pairs = [for pair in split(",", var.tags) : split("=", pair) if trimspace(pair) != ""]
  extra_tags = {
    for pair in local.extra_tag_pairs : trimspace(pair[0]) => trimspace(join("=", slice(pair, 1, length(pair))))
  }
  tags = merge(local.extra_tags, { "azd-env-name" = var.environment_name })

  # Optional azd values: an empty value selects the default. hooks/preprovision.sh mirrors these defaults.
  model = {
    name     = coalesce(var.model_name, "gpt-6-luna")
    version  = coalesce(var.model_version, "2026-09-22")
    sku      = coalesce(var.model_sku, "DataZoneStandard")
    capacity = tonumber(coalesce(var.model_capacity, "50"))
  }

  account_name = "ais-${var.environment_name}-${local.token}"
  api_version  = "2025-06-01"
  # "Foundry User" (formerly "Azure AI User"): calls to any Foundry model, not only Azure OpenAI ones.
  foundry_user_role_id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/53ca6127-db72-4b80-b1b0-d745d6d5456d"
}

resource "azapi_resource" "account" {
  type      = "Microsoft.CognitiveServices/accounts@${local.api_version}"
  name      = local.account_name
  parent_id = local.resource_group_id
  location  = var.location
  tags      = local.tags

  identity {
    type = "SystemAssigned"
  }

  body = {
    kind = "AIServices"
    sku  = { name = "S0" }
    properties = {
      allowProjectManagement = true
      customSubDomainName    = local.account_name
      disableLocalAuth       = true
      publicNetworkAccess    = "Enabled"
    }
  }
}

resource "azapi_resource" "project" {
  type      = "Microsoft.CognitiveServices/accounts/projects@${local.api_version}"
  name      = "proj-${var.environment_name}"
  parent_id = azapi_resource.account.id
  location  = var.location
  tags      = local.tags

  identity {
    type = "SystemAssigned"
  }

  body = {
    properties = {
      displayName = var.environment_name
    }
  }

  response_export_values = ["identity.principalId"]
}

resource "azapi_resource" "model" {
  type = "Microsoft.CognitiveServices/accounts/deployments@${local.api_version}"
  # Deployment names must not contain the reserved word "Microsoft".
  name      = local.model.name
  parent_id = azapi_resource.account.id

  body = {
    sku = {
      name     = local.model.sku
      capacity = local.model.capacity
    }
    properties = {
      model = {
        format  = "OpenAI"
        name    = local.model.name
        version = local.model.version
      }
      versionUpgradeOption = "NoAutoUpgrade"
      raiPolicyName        = "Microsoft.DefaultV2"
    }
  }

  # Concurrent operations on the same account fail with a conflict.
  depends_on = [azapi_resource.project]
}

# Documented Foundry form: the "key" is the ingestion connection string, an endpoint identifier rather than a
# credential; local authentication is disabled on Application Insights, so ingestion still requires an Entra token.
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

# The principal running azd may call the model too, to try it from a laptop (dev).
resource "azurerm_role_assignment" "deployer_foundry" {
  scope              = azapi_resource.account.id
  role_definition_id = local.foundry_user_role_id
  principal_id       = data.azurerm_client_config.current.object_id
}
