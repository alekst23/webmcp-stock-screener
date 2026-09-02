output "service_arn" {
  value = aws_apprunner_service.this.arn
}

output "service_id" {
  value = aws_apprunner_service.this.service_id
}

output "service_url" {
  description = "The stable App Runner hostname (no scheme -- the service is reachable at https://<this value>), AC11."
  value       = aws_apprunner_service.this.service_url
}

output "status" {
  value = aws_apprunner_service.this.status
}
