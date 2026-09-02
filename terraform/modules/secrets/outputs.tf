output "eodhd_api_key_parameter_name" {
  description = "SSM parameter name the running task reads at startup (T-0016-6 / T-0016-8) -- never the value."
  value       = aws_ssm_parameter.eodhd_api_key.name
}

output "eodhd_api_key_parameter_arn" {
  value = aws_ssm_parameter.eodhd_api_key.arn
}
