output "pull_log_role_arn" {
  description = "Attach as App Runner's access role and ECS's task execution role."
  value       = aws_iam_role.pull_log.arn
}

output "app_role_arn" {
  description = "Attach as App Runner's instance role and ECS's task role."
  value       = aws_iam_role.app.arn
}

output "app_role_name" {
  description = "T-0016-5: the role name the secrets module attaches its read-only grant to."
  value       = aws_iam_role.app.name
}
