# Outputs become azd environment values (prefixed FOUNDRY_), read by the workload layers. No secrets.

output "FOUNDRY_ACCOUNT_ID" { value = azapi_resource.account.id }
output "FOUNDRY_ACCOUNT_NAME" { value = azapi_resource.account.name }
output "FOUNDRY_PROJECT_ENDPOINT" { value = "https://${local.account_name}.services.ai.azure.com/api/projects/${azapi_resource.project.name}" }
output "FOUNDRY_OPENAI_ENDPOINT" { value = "https://${local.account_name}.openai.azure.com/" }
output "FOUNDRY_MODEL_DEPLOYMENT_NAME" { value = azapi_resource.model.name }
