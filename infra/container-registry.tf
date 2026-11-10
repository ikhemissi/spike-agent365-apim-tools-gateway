# The registry azd builds the services' images in (remote build: no local Docker needed), and the identity the
# container apps pull them with.

module "container_registry" {
  source                     = "./modules/container-registry"
  name                       = "cr${local.compact_name}${local.token}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = var.location
  tags                       = local.tags
  private_endpoint_subnet_id = lookup(local.network.subnet_ids, "private-endpoints", null)
  private_dns_zone_ids       = local.network.private_dns_zone_ids
}

output "AZURE_CONTAINER_REGISTRY_ENDPOINT" { value = module.container_registry.login_server }
