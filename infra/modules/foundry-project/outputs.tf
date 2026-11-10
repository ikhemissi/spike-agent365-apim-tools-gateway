output "account_id" {
  value = azapi_resource.account.id
}

output "account_name" {
  value = azapi_resource.account.name
}

output "project_id" {
  value = azapi_resource.project.id
}

output "project_name" {
  value = azapi_resource.project.name
}

output "project_endpoint" {
  value = "https://${var.account_name}.services.ai.azure.com/api/projects/${azapi_resource.project.name}"
}

output "openai_endpoint" {
  value = "https://${var.account_name}.openai.azure.com/"
}

output "model_deployment_name" {
  value = azapi_resource.model.name
}
