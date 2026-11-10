variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "log_analytics_workspace_id" {
  type = string
}

variable "subnet_id" {
  description = "Subnet delegated to Microsoft.App/environments, to join a virtual network. Null: no virtual network."
  type        = string
  default     = null
}
