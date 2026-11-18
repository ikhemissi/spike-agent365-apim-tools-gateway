variable "account_name" {
  description = "Globally unique; also the account's subdomain (<name>.services.ai.azure.com)."
  type        = string
}

variable "project_name" {
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

variable "model" {
  description = "The chat model deployment: model name and version, SKU (e.g. GlobalStandard, DataZoneStandard) and capacity in thousands of tokens per minute."
  type = object({
    name     = string
    version  = string
    sku      = string
    capacity = number
  })
}

variable "application_insights_id" {
  type = string
}

variable "application_insights_connection_string" {
  type      = string
  sensitive = true
}

variable "public_network_access_enabled" {
  description = "False once every client reaches the account through the virtual network."
  type        = bool
  default     = true
}

variable "private_endpoint" {
  description = "Private endpoint: its subnet, and the private DNS zone ids by zone name (the network module's output; the cognitiveservices, openai and services.ai privatelink zones are used). Null: none."
  # An object rather than a subnet id: whether there is one stays known at plan time, also when the subnet is created
  # in the same plan (count on a subnet id that is not known yet fails with "Invalid count argument").
  type = object({
    subnet_id            = string
    private_dns_zone_ids = map(string)
  })
  default = null
}
