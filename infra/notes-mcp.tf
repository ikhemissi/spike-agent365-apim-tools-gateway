# The notes MCP server (services/notes-mcp, deployed by azd): a team's notes in tables of its own storage account,
# reached with its managed identity. Who may call it is set in connections.tf (local.notes_mcp_allowed_caller_id):
# - empty: internal ingress, only apps of the Container Apps environment reach it (e.g. LiteLLM);
# - an identity's object id (e.g. API Management's): external ingress, and only that identity's Entra tokens for this
#   server's own app registration are accepted (services/notes-mcp/caller_auth.py).

variable "notes_mcp_image" {
  description = "The image azd deployed (SERVICE_NOTES_MCP_IMAGE_NAME). Empty before the first deployment."
  type        = string
}

locals {
  notes_mcp_checks_caller = local.notes_mcp_allowed_caller_id != ""
}

resource "azuread_application" "notes_mcp" {
  count            = local.notes_mcp_checks_caller ? 1 : 0
  display_name     = "Notes MCP (${var.environment_name})"
  sign_in_audience = "AzureADMyOrg"
  owners           = [data.azurerm_client_config.current.object_id]

  lifecycle {
    ignore_changes = [identifier_uris]
  }
}

resource "azuread_application_identifier_uri" "notes_mcp" {
  count          = local.notes_mcp_checks_caller ? 1 : 0
  application_id = azuread_application.notes_mcp[0].id
  identifier_uri = "api://${azuread_application.notes_mcp[0].client_id}"
}

resource "azuread_service_principal" "notes_mcp" {
  count     = local.notes_mcp_checks_caller ? 1 : 0
  client_id = azuread_application.notes_mcp[0].client_id
  owners    = [data.azurerm_client_config.current.object_id]
}

module "notes_storage" {
  source                     = "./modules/storage-account"
  name                       = "stnotes${local.token}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = var.location
  tags                       = local.tags
  private_endpoint_subnet_id = lookup(local.network.subnet_ids, "private-endpoints", null)
  private_endpoint_services  = ["table"]
  private_dns_zone_ids       = local.network.private_dns_zone_ids
}

module "notes_mcp" {
  source                        = "./modules/container-app"
  name                          = "ca-notes-mcp-${local.token}"
  azd_service_name              = "notes-mcp"
  image                         = var.notes_mcp_image
  port                          = 8080
  external                      = local.notes_mcp_checks_caller
  resource_group_name           = azurerm_resource_group.main.name
  location                      = var.location
  tags                          = local.tags
  container_apps_environment_id = module.container_apps_environment.id
  registry_server               = module.container_registry.login_server
  registry_pull_identity_id     = module.container_registry.pull_identity_id

  env = merge(
    { NOTES_TABLE_ENDPOINT = module.notes_storage.primary_table_endpoint },
    {
      for name, value in {
        NOTES_AUTH_TENANT_ID    = data.azurerm_client_config.current.tenant_id
        NOTES_AUTH_AUDIENCE     = one(azuread_application_identifier_uri.notes_mcp[*].identifier_uri)
        NOTES_ALLOWED_CALLER_ID = local.notes_mcp_allowed_caller_id
      } : name => value if local.notes_mcp_checks_caller
    },
  )

  role_assignments = {
    tables = { scope = module.notes_storage.id, role = "Storage Table Data Contributor" }
  }
}

# With internal ingress, the URL resolves only inside the Container Apps environment; NOTES_MCP_AUDIENCE is empty then.
output "NOTES_MCP_URL" { value = "${module.notes_mcp.url}/mcp" }
output "NOTES_MCP_AUDIENCE" { value = coalesce(one(azuread_application_identifier_uri.notes_mcp[*].identifier_uri), "") }
