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
  resource_group_name       = "rg-test"
  location                  = "francecentral"
  name                      = "sttest"
  private_endpoint_services = ["table"]
}

run "public" {
  command = plan

  assert {
    condition     = length(azurerm_private_endpoint.main) == 0
    error_message = "No private endpoint without a subnet."
  }
}

run "private_endpoint" {
  command = plan

  variables {
    private_endpoint_subnet_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/virtualNetworks/vnet-test/subnets/private-endpoints"
    private_dns_zone_ids = {
      "privatelink.table.core.windows.net" = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/privateDnsZones/privatelink.table.core.windows.net"
    }
  }

  assert {
    condition     = length(azurerm_private_endpoint.main) == 1
    error_message = "A private endpoint in the given subnet."
  }
  assert {
    condition     = azurerm_private_endpoint.main["table"].private_service_connection[0].subresource_names[0] == "table"
    error_message = "One private endpoint per listed service."
  }
}
