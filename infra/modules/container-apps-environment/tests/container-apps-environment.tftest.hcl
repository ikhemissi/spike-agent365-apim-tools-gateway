# The environment joins a virtual network only when given a subnet.

mock_provider "azurerm" {}

variables {
  name                       = "cae-test"
  resource_group_name        = "rg-test"
  location                   = "francecentral"
  log_analytics_workspace_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.OperationalInsights/workspaces/log-test"
}

run "public" {
  command = plan

  assert {
    condition     = azurerm_container_app_environment.main.infrastructure_subnet_id == null
    error_message = "No subnet by default."
  }
}

run "in_a_virtual_network" {
  command = plan

  variables {
    subnet_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/virtualNetworks/vnet-test/subnets/container-apps"
  }

  assert {
    condition     = azurerm_container_app_environment.main.infrastructure_subnet_id == var.subnet_id
    error_message = "The environment uses the given subnet."
  }
}
