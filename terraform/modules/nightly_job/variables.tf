variable "environment" {
  description = "Environment name, used in resource names and tags."
  type        = string
}

variable "region" {
  description = "Region the task runs in -- used to scope log-group ARNs and the awslogs driver."
  type        = string
}

variable "image_identifier" {
  description = "Full ECR image reference (repository URL + immutable tag) -- the same image App Runner runs (AC2)."
  type        = string
}

variable "vpc_id" {
  description = "VPC the task's security group is created in (T-0016-4's dedicated VPC)."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets the task launches into with an assigned public IP -- no NAT gateway."
  type        = list(string)
}

variable "execution_role_arn" {
  description = "ECS task execution role -- image pull + log write. Reuses the App Runner pull/log role unchanged (AC8)."
  type        = string
}

variable "execution_role_name" {
  description = <<-EOT
    Name of the execution role above, for attaching the secrets-read grant
    ECS needs at container launch. Discovered live (not assumed): ECS
    resolves task-definition `secrets` on the *execution* role, unlike App
    Runner, which resolves `runtime_environment_secrets` on the *instance*
    role. The App Runner-era grant on the app/task role does not cover this.
  EOT
  type        = string
}

variable "task_role_arn" {
  description = "ECS task role -- the panel-bucket application identity. Reuses the App Runner app role unchanged (AC8)."
  type        = string
}

variable "panel_bucket_name" {
  description = "Bucket the job reads and writes (OBJECT_STORE_BUCKET)."
  type        = string
}

variable "eodhd_api_key_parameter_arn" {
  description = "SSM parameter ARN the container resolves EODHD_API_KEY from -- never the value."
  type        = string
}

variable "schedule_expression" {
  description = <<-EOT
    EventBridge Scheduler cron expression (AC1's "the schedule is a
    configuration input"). Default translates Render's `30 6 * * *` (06:30
    UTC daily) to EventBridge's 6-field syntax: minute=30, hour=6, every
    day-of-month, every month, day-of-week unspecified (`?`, required
    because day-of-month is a literal `*`), no explicit year.
  EOT
  type        = string
  default     = "cron(30 6 * * ? *)"
}

variable "schedule_enabled" {
  description = <<-EOT
    Whether the EventBridge Scheduler rule actually fires. Default false
    (AC9): the Render cron is still the live scheduled writer, so this rule
    is created wired and correctly scheduled but inert, proven end-to-end
    only via on-demand `aws ecs run-task` invocations. T-0016-10/T-0016-11
    flips this to true in the same change that retires the Render cron, so
    exactly one scheduled writer is ever active.
  EOT
  type        = bool
  default     = false
}

variable "cpu" {
  description = "Fargate task CPU, in vCPU units as a string. The job is I/O-bound (S3 + one bulk EODHD call), not compute-bound."
  type        = string
  default     = "512"
}

variable "memory" {
  description = "Fargate task memory in MB, as a string. Holds one panel Parquet download/parse/re-upload, not a resident server -- far less than the API's 2 GB."
  type        = string
  default     = "1024"
}

variable "log_retention_days" {
  description = "Explicit CloudWatch Logs retention for the task's log group."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Common tags merged into every resource this module creates."
  type        = map(string)
  default     = {}
}
