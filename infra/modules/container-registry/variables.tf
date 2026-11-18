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

variable "private_endpoint" {
  description = "Private endpoint: its subnet, and the private DNS zone ids by zone name (the network module's output; privatelink.azurecr.io is used). Null: none."
  # An object rather than a subnet id: whether there is one stays known at plan time, also when the subnet is created
  # in the same plan (count on a subnet id that is not known yet fails with "Invalid count argument").
  type = object({
    subnet_id            = string
    private_dns_zone_ids = map(string)
  })
  default = null
}
