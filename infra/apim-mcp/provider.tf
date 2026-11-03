terraform {
  required_version = ">= 1.9"

  required_providers {
    azapi = {
      source  = "azure/azapi"
      version = "~> 2.13"
    }
  }

  # Remote state in an Entra-authenticated storage account, one key per layer (provider.conf.json).
  backend "azurerm" {}
}

provider "azapi" {
  subscription_id = var.subscription_id
}
