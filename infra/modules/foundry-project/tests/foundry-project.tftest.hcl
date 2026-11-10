# Public by default; given a private endpoint subnet, a private endpoint registered in the private DNS zone.

mock_provider "azapi" {}

mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      tenant_id       = "00000000-0000-0000-0000-000000000001"
      subscription_id = "00000000-0000-0000-0000-000000000000"
    }
  }
}

variables {
  resource_group_name                    = "rg-test"
  location                               = "francecentral"
  account_name                           = "ais-test"
  project_name                           = "proj-test"
  application_insights_id                = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Insights/components/appi-test"
  application_insights_connection_string = "InstrumentationKey=00000000-0000-0000-0000-000000000002"
  model                                  = { name = "gpt-test", version = "1", sku = "GlobalStandard", capacity = 10 }
}

run "public" {
  command = plan

  assert {
    condition     = length(azurerm_private_endpoint.main) == 0
    error_message = "No private endpoint without a subnet."
  }
  assert {
    condition     = azapi_resource.account.body.properties.disableLocalAuth
    error_message = "Keys are disabled."
  }
}

run "private_endpoint" {
  command = plan

  variables {
    private_endpoint_subnet_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/virtualNetworks/vnet-test/subnets/private-endpoints"
    private_dns_zone_ids = {
      "privatelink.cognitiveservices.azure.com" = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/privateDnsZones/privatelink.cognitiveservices.azure.com"
      "privatelink.openai.azure.com"            = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/privateDnsZones/privatelink.openai.azure.com"
      "privatelink.services.ai.azure.com"       = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/privateDnsZones/privatelink.services.ai.azure.com"
    }
  }

  assert {
    condition     = length(azurerm_private_endpoint.main) == 1
    error_message = "A private endpoint in the given subnet."
  }
  assert {
    condition     = length(azurerm_private_endpoint.main[0].private_dns_zone_group[0].private_dns_zone_ids) == 3
    error_message = "The account registers in its three private DNS zones."
  }
}
