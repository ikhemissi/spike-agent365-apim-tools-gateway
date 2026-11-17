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

variable "internal" {
  description = "True: apps are reachable from the virtual network only, through an internal load balancer (needs subnet_id)."
  type        = bool
  default     = false

  validation {
    condition     = !var.internal || var.subnet_id != null
    error_message = "An internal environment needs subnet_id."
  }
}
