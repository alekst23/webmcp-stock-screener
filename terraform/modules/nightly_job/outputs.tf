output "cluster_arn" {
  description = "For on-demand `aws ecs run-task` invocations (ordinary run and --catch-up)."
  value       = aws_ecs_cluster.nightly.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.nightly.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.nightly_delta.arn
}

output "task_definition_family" {
  value = aws_ecs_task_definition.nightly_delta.family
}

output "security_group_id" {
  value = aws_security_group.nightly_delta.id
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.nightly_delta.name
}

output "schedule_arn" {
  value = aws_scheduler_schedule.nightly_delta.arn
}

output "schedule_state" {
  description = "ENABLED or DISABLED -- see the module's schedule_enabled input and AC9."
  value       = aws_scheduler_schedule.nightly_delta.state
}
