# A storage account reached only with Entra ID (shared keys disabled). Given a private endpoint subnet, it gets one
# private endpoint per listed service (blob, table, queue, file).

resource "azurerm_storage_account" "main" {
  name                            = var.name
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  min_tls_version                 = "TLS1_2"
  public_network_access_enabled   = var.public_network_access_enabled
  tags                            = var.tags
}

resource "azurerm_private_endpoint" "main" {
  for_each            = var.private_endpoint_subnet_id == null ? toset([]) : toset(var.private_endpoint_services)
  name                = "pe-${var.name}-${each.value}"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoint_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "${var.name}-${each.value}"
    private_connection_resource_id = azurerm_storage_account.main.id
    subresource_names              = [each.value]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_ids["privatelink.${each.value}.core.windows.net"]]
  }
}
