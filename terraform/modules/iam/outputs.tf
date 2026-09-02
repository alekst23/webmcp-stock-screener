output "pull_log_role_arn" {
  description = "Attach as App Runner's access role and ECS's task execution role."
  value       = aws_iam_role.pull_log.arn
}

output "pull_log_role_name" {
  description = "T-0016-8: the role name the nightly_job module attaches its execution-role secrets-read grant to -- ECS resolves task-definition `secrets` on the execution role, not the task role (App Runner resolves the equivalent on the instance role instead)."
  value       = aws_iam_role.pull_log.name
}

output "app_role_arn" {
  description = "Attach as App Runner's instance role and ECS's task role."
  value       = aws_iam_role.app.arn
}

output "app_role_name" {
  description = "T-0016-5: the role name the secrets module attaches its read-only grant to."
  value       = aws_iam_role.app.name
}
