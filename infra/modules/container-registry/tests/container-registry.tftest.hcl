# Public by default; given a private endpoint subnet, a private endpoint registered in the private DNS zone.

mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      tenant_id       = "00000000-0000-0000-0000-000000000001"
      subscription_id = "00000000-0000-0000-0000-000000000000"
    }
  }
}

variables {
  resource_group_name = "rg-test"
  location            = "francecentral"
  name                = "crtest"
}

run "public" {
  command = plan

  assert {
    condition     = length(azurerm_private_endpoint.main) == 0
    error_message = "No private endpoint without a subnet."
  }
  assert {
    condition     = azurerm_container_registry.main.sku == "Basic"
    error_message = "Basic SKU without a private endpoint."
  }
}

run "private_endpoint" {
  command = plan

  variables {
    private_endpoint_subnet_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/virtualNetworks/vnet-test/subnets/private-endpoints"
    private_dns_zone_ids = {
      "privatelink.azurecr.io" = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/privateDnsZones/privatelink.azurecr.io"
    }
  }

  assert {
    condition     = length(azurerm_private_endpoint.main) == 1
    error_message = "A private endpoint in the given subnet."
  }
  assert {
    condition     = azurerm_container_registry.main.sku == "Premium"
    error_message = "Private endpoints need the Premium SKU."
  }
}
