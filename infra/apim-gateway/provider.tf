terraform {
  required_version = ">= 1.9"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.81"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.10"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }

  # Remote state in an Entra-authenticated storage account, one key per layer (provider.conf.json).
  backend "azurerm" {}
}

provider "azurerm" {
  features {
    api_management {
      # A soft-deleted instance keeps its name. With azd down, azure-platform's predown hook purges it instead.
      purge_soft_delete_on_destroy = true
    }
  }
  subscription_id     = var.subscription_id
  storage_use_azuread = true
}

provider "azuread" {}
