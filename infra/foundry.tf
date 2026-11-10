# Microsoft Foundry: the project the agents live in, and the chat model they and the gateways use. Tracing goes to
# Application Insights. Defaults of the model settings: main.tfvars.json (and scripts/check-model-quota.sh).

variable "model_name" {
  description = "Foundry chat model (MODEL_NAME)."
  type        = string
}

variable "model_version" {
  description = "Model version (MODEL_VERSION)."
  type        = string
}

variable "model_sku" {
  description = "Deployment SKU (MODEL_SKU), e.g. DataZoneStandard to keep data in the EU data zone, or GlobalStandard."
  type        = string
}

variable "model_capacity" {
  description = "Deployment capacity in thousands of tokens per minute (MODEL_CAPACITY)."
  type        = number
}

module "foundry" {
  source                                 = "./modules/foundry-project"
  account_name                           = "ais-${var.environment_name}-${local.token}"
  project_name                           = "proj-${var.environment_name}"
  resource_group_name                    = azurerm_resource_group.main.name
  location                               = var.location
  tags                                   = local.tags
  application_insights_id                = module.monitoring.application_insights_id
  application_insights_connection_string = module.monitoring.application_insights_connection_string
  private_endpoint_subnet_id             = lookup(local.network.subnet_ids, "private-endpoints", null)
  private_dns_zone_ids                   = local.network.private_dns_zone_ids

  model = {
    name     = var.model_name
    version  = var.model_version
    sku      = var.model_sku
    capacity = var.model_capacity
  }
}

# The deployer may call the model too, to try it from a laptop. "Foundry User" (formerly "Azure AI User").
resource "azurerm_role_assignment" "deployer_foundry_user" {
  scope              = module.foundry.account_id
  role_definition_id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/53ca6127-db72-4b80-b1b0-d745d6d5456d"
  principal_id       = data.azurerm_client_config.current.object_id
}

output "FOUNDRY_ACCOUNT_ID" { value = module.foundry.account_id }
output "FOUNDRY_PROJECT_ENDPOINT" { value = module.foundry.project_endpoint }
output "FOUNDRY_MODEL_DEPLOYMENT_NAME" { value = module.foundry.model_deployment_name }
# The azd agents extension finds the project of the agent services (azure.yaml) through this value.
output "AZURE_AI_PROJECT_ID" { value = module.foundry.project_id }
