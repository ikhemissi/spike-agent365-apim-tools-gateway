# azd passes every value of main.tfvars.json as a string, empty when the azd environment does not set it.

variable "environment_name" {
  description = "azd environment name (AZURE_ENV_NAME); prefixes resource names and is set as the azd-env-name tag."
  type        = string
}

variable "subscription_id" {
  description = "Target subscription (AZURE_SUBSCRIPTION_ID)."
  type        = string
}

variable "location" {
  description = "Region of every resource (AZURE_LOCATION)."
  type        = string
  default     = "francecentral"
}

variable "tags" {
  description = "Extra tags on every resource, as comma-separated key=value pairs (RESOURCE_TAGS), e.g. tags required by your tenant's policies. Empty: none."
  type        = string
  default     = ""

  validation {
    condition     = alltrue([for pair in split(",", var.tags) : trimspace(pair) == "" || can(regex("^[^=]+=.*$", trimspace(pair)))])
    error_message = "tags must be comma-separated key=value pairs."
  }
}
