# The environment joins a virtual network only when given a subnet, and is internal only when asked to be (with a subnet).

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

run "internal" {
  command = plan

  variables {
    subnet_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/virtualNetworks/vnet-test/subnets/egress-proxy"
    internal  = true
  }

  assert {
    condition     = azurerm_container_app_environment.main.internal_load_balancer_enabled == true
    error_message = "An internal environment is reached through an internal load balancer."
  }
}

run "internal_needs_a_subnet" {
  command = plan

  variables {
    internal = true
  }

  expect_failures = [var.internal]
}
