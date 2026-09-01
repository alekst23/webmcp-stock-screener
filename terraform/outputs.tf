# Consumed by T-0016-5 (secrets), T-0016-6 (App Runner service module),
# T-0016-7 (panel migration), and T-0016-8 (nightly Fargate task).

output "region" {
  value = var.region
}

output "environment" {
  value = var.environment
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "public_subnet_ids" {
  description = "For T-0016-8's Fargate task network configuration."
  value       = module.network.public_subnet_ids
}

output "panel_bucket_name" {
  value = module.panel_bucket.bucket_name
}

output "panel_bucket_arn" {
  value = module.panel_bucket.bucket_arn
}

output "ecr_repository_url" {
  description = "For T-0016-1's image push and T-0016-6/T-0016-8's image reference."
  value       = module.registry.repository_url
}

output "ecr_repository_arn" {
  value = module.registry.repository_arn
}

output "pull_log_role_arn" {
  description = "App Runner access role / ECS task execution role."
  value       = module.iam.pull_log_role_arn
}

output "app_role_arn" {
  description = "App Runner instance role / ECS task role -- the panel bucket identity."
  value       = module.iam.app_role_arn
}

output "eodhd_api_key_parameter_name" {
  description = "T-0016-5: SSM parameter name for T-0016-6/T-0016-8 to reference in the task's secrets, not its value."
  value       = module.secrets.eodhd_api_key_parameter_name
}

output "eodhd_api_key_parameter_arn" {
  value = module.secrets.eodhd_api_key_parameter_arn
}

output "apprunner_service_url" {
  description = "T-0016-6 AC11: the service's stable hostname. Reachable at https://<this value>; T-0016-10 consumes this."
  value       = module.apprunner_service.service_url
}

output "apprunner_service_arn" {
  value = module.apprunner_service.service_arn
}
