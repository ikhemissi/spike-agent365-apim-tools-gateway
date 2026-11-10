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

variable "log_analytics_name" {
  type = string
}

variable "application_insights_name" {
  type = string
}

variable "retention_in_days" {
  description = "How long Log Analytics keeps logs and traces."
  type        = number
  default     = 30
}
