# azd passes every value of main.tfvars.json as a string, empty when the azd environment does not set it.

variable "environment_name" {
  description = "azd environment name (AZURE_ENV_NAME)."
  type        = string
}

variable "subscription_id" {
  description = "Target subscription (AZURE_SUBSCRIPTION_ID)."
  type        = string
}

variable "location" {
  description = "Region (AZURE_LOCATION)."
  type        = string
  default     = "francecentral"
}

variable "tags" {
  description = "Extra tags, as comma-separated key=value pairs (RESOURCE_TAGS). Empty: none."
  type        = string
  default     = ""
}

variable "resource_group_name" {
  description = "Resource group of the platform layer (AZURE_RESOURCE_GROUP)."
  type        = string

  validation {
    condition     = var.resource_group_name != ""
    error_message = "AZURE_RESOURCE_GROUP is empty: provision the azure-platform layer first."
  }
}

variable "container_app_environment_id" {
  description = "Container Apps environment of the platform layer (AZURE_CONTAINER_APPS_ENVIRONMENT_ID)."
  type        = string
}

variable "container_apps_default_domain" {
  description = "Its default domain (PLATFORM_CONTAINER_APPS_DEFAULT_DOMAIN), for the app's URL before the app exists."
  type        = string
}

variable "registry_server" {
  description = "Container registry of the platform layer (AZURE_CONTAINER_REGISTRY_ENDPOINT), where azd builds the image."
  type        = string
}

variable "acr_pull_identity_id" {
  description = "The platform's image-pull identity (PLATFORM_ACR_PULL_IDENTITY_ID)."
  type        = string
}

variable "key_vault_id" {
  description = "The platform's Key Vault (PLATFORM_KEY_VAULT_ID), holding the team's LiteLLM key."
  type        = string
}

variable "key_vault_uri" {
  description = "Its URI (PLATFORM_KEY_VAULT_URI)."
  type        = string
}

variable "litellm_key_secret_name" {
  description = "With LiteLLM: Key Vault secret holding the team's LiteLLM virtual key the UI uses (CHAT_UI_LITELLM_KEY_SECRET_NAME). Empty: litellm-key-chat-ui. Create it before provisioning this layer."
  type        = string
  default     = ""
}

variable "application_insights_id" {
  description = "Application Insights of the platform layer (PLATFORM_APPLICATION_INSIGHTS_ID)."
  type        = string
}

variable "application_insights_connection_string" {
  description = "Its connection string (PLATFORM_APPLICATION_INSIGHTS_CONNECTION_STRING); locates the resource, ingestion still requires Entra."
  type        = string
  sensitive   = true
}

variable "litellm_url" {
  description = "A LiteLLM gateway (LITELLM_URL, from the litellm-gateway layer). Set this or apim_models_url."
  type        = string
  default     = ""

  validation {
    condition     = var.litellm_url == "" || startswith(var.litellm_url, "https://")
    error_message = "LITELLM_URL must be an HTTPS URL."
  }
}

variable "apim_models_url" {
  description = "An API Management gateway's model API (APIM_MODELS_URL, from the apim-gateway layer). Set this or litellm_url."
  type        = string
  default     = ""

  validation {
    condition     = (var.apim_models_url == "") != (var.litellm_url == "") && (var.apim_models_url == "" || startswith(var.apim_models_url, "https://"))
    error_message = "Exactly one gateway: provision either the litellm-gateway layer (LITELLM_URL) or the apim-gateway layer (APIM_MODELS_URL, HTTPS)."
  }
}

variable "apim_gateway_scope" {
  description = "With API Management: its app registration's scope (APIM_GATEWAY_SCOPE), for the users' own tokens."
  type        = string
  default     = ""

  validation {
    condition     = var.apim_models_url == "" || startswith(var.apim_gateway_scope, "api://")
    error_message = "APIM_GATEWAY_SCOPE is empty: provision the apim-gateway layer first."
  }
}

variable "mcp_servers" {
  description = "With API Management: the MCP servers the UI calls through it, as comma-separated label=url (CHAT_UI_MCP_SERVERS), e.g. notes=https://<apim>.azure-api.net/notes."
  type        = string
  default     = ""

  validation {
    condition     = var.apim_models_url == "" || var.mcp_servers != ""
    error_message = "CHAT_UI_MCP_SERVERS is empty: with API Management the UI calls the MCP servers itself (label=url,...)."
  }
}

variable "model" {
  description = "The model the UI asks the gateway for (FOUNDRY_MODEL_DEPLOYMENT_NAME)."
  type        = string
}

variable "image" {
  description = "Image deployed by azd (SERVICE_CHAT_UI_IMAGE_NAME); empty before the first deployment."
  type        = string
  default     = ""
}

variable "gateway_scope" {
  description = "With LiteLLM, only when it runs the Agent 365 guardrail: the gateway app registration's delegated scope, api://<gateway app id>/<scope> (CHAT_UI_GATEWAY_SCOPE). The gateway app must pre-authorize this layer's client id (CHAT_UI_CLIENT_ID). Empty: the UI sends no user token to the gateway."
  type        = string
  default     = ""
}

variable "title" {
  description = "The page's title, also the app registration's display name (CHAT_UI_TITLE). Empty: Chat."
  type        = string
  default     = ""
}

variable "intro" {
  description = "The text under the title (CHAT_UI_INTRO). Empty: the app's generic line."
  type        = string
  default     = ""
}

variable "instructions" {
  description = "The model's instructions: which tools to use for what (CHAT_UI_INSTRUCTIONS). Empty: the app's generic prompt."
  type        = string
  default     = ""
}
