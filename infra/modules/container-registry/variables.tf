variable "name" {
  description = "Globally unique, alphanumeric only."
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
  description = "False once images are built and pulled only through the virtual network."
  type        = bool
  default     = true
}

variable "private_endpoint_subnet_id" {
  description = "Subnet for a private endpoint. Null: none."
  type        = string
  default     = null
}

variable "private_dns_zone_ids" {
  description = "Private DNS zone ids by zone name (the network module's output); privatelink.azurecr.io is used."
  type        = map(string)
  default     = {}
}
