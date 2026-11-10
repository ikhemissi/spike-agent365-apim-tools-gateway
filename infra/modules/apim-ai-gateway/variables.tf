variable "name" {
  description = "API Management instance name (globally unique)."
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

variable "publisher_name" {
  description = "Shown in the instance's settings."
  type        = string
}

variable "publisher_email" {
  description = "Receives API Management's service notifications."
  type        = string
}

variable "foundry_account_id" {
  description = "The gateway's identity gets the Foundry User role on this account."
  type        = string
}

variable "foundry_openai_endpoint" {
  description = "The account's OpenAI endpoint (https://<account>.openai.azure.com/)."
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Where the gateway logs go."
  type        = string
}

variable "gateway_client_id" {
  description = "Client id of the gateway's app registration: callers' tokens must be issued for it."
  type        = string
}

variable "gateway_scope" {
  description = "The delegated scope callers' tokens must carry, e.g. Gateway.Use."
  type        = string
}
