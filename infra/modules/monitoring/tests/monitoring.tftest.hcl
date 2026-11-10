# Application Insights accepts only Entra-authenticated telemetry, and keeps its data in the workspace.

mock_provider "azurerm" {}

run "entra_only_telemetry" {
  command = plan

  variables {
    resource_group_name       = "rg-test"
    location                  = "francecentral"
    log_analytics_name        = "log-test"
    application_insights_name = "appi-test"
  }

  assert {
    condition     = azurerm_application_insights.main.local_authentication_enabled == false
    error_message = "Telemetry needs an Entra token: no instrumentation key works."
  }
  assert {
    condition     = azurerm_log_analytics_workspace.main.retention_in_days == 30
    error_message = "Logs and traces are kept 30 days by default."
  }
}
