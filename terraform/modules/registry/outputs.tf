output "repository_url" {
  description = "For T-0016-1's image push and T-0016-6/T-0016-8's image reference."
  value       = aws_ecr_repository.backend.repository_url
}

output "repository_arn" {
  value = aws_ecr_repository.backend.arn
}

output "repository_name" {
  value = aws_ecr_repository.backend.name
}
