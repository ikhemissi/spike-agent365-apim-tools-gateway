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

variable "private_endpoint_services" {
  description = "The services that get a private endpoint: blob, table, queue or file."
  type        = list(string)
  default     = ["blob"]
}

variable "private_endpoint" {
  description = "Private endpoint: its subnet, and the private DNS zone ids by zone name (the network module's output; privatelink.<service>.core.windows.net is used, per service). Null: none."
  # An object rather than a subnet id: whether there is one stays known at plan time, also when the subnet is created
  # in the same plan (count on a subnet id that is not known yet fails with "Invalid count argument").
  type = object({
    subnet_id            = string
    private_dns_zone_ids = map(string)
  })
  default = null
}
