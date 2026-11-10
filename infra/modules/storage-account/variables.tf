variable "name" {
  description = "Globally unique, 3 to 24 lowercase letters and digits."
  type        = string
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

variable "public_network_access_enabled" {
  description = "False once every client reaches the account through the virtual network."
  type        = bool
  default     = true
}

variable "private_endpoint_subnet_id" {
  description = "Subnet for the private endpoints. Null: none."
  type        = string
  default     = null
}

variable "private_endpoint_services" {
  description = "The services that get a private endpoint: blob, table, queue or file."
  type        = list(string)
  default     = ["blob"]
}

variable "private_dns_zone_ids" {
  description = "Private DNS zone ids by zone name (the network module's output); privatelink.<service>.core.windows.net is used."
  type        = map(string)
  default     = {}
}
