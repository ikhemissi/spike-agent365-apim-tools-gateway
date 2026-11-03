# azd passes every value of main.tfvars.json as a string. All come from earlier layers.

variable "subscription_id" {
  description = "Target subscription (AZURE_SUBSCRIPTION_ID)."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group of the platform layer (AZURE_RESOURCE_GROUP)."
  type        = string
}

variable "apim_name" {
  description = "The API Management gateway (APIM_NAME)."
  type        = string

  validation {
    condition     = var.apim_name != ""
    error_message = "APIM_NAME is empty: provision the apim-gateway layer first."
  }
}

variable "apim_gateway_url" {
  description = "Its URL (APIM_GATEWAY_URL)."
  type        = string
}

variable "apim_gateway_client_id" {
  description = "Its app registration, the audience of the users' tokens (APIM_GATEWAY_CLIENT_ID)."
  type        = string
}

variable "notes_mcp_url" {
  description = "The notes MCP server's endpoint (NOTES_MCP_URL), https://.../mcp."
  type        = string

  validation {
    condition     = startswith(var.notes_mcp_url, "https://")
    error_message = "NOTES_MCP_URL is empty: provision the notes-mcp layer first."
  }
}

variable "notes_mcp_audience" {
  description = "The notes server's app ID URI (NOTES_MCP_AUDIENCE), for the gateway's token."
  type        = string

  validation {
    condition     = startswith(var.notes_mcp_audience, "api://")
    error_message = "NOTES_MCP_AUDIENCE is empty: the notes-mcp layer must accept the gateway's identity (apim-gateway provisioned first)."
  }
}
