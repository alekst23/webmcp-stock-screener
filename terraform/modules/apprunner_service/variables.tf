variable "environment" {
  description = "Environment name, used in resource names and tags."
  type        = string
}

variable "region" {
  description = "Region the service is deployed in -- used to scope log-group ARNs."
  type        = string
}

variable "account_id" {
  description = "Caller account ID -- used to scope log-group ARNs."
  type        = string
}

variable "image_identifier" {
  description = "Full ECR image reference (repository URL + immutable tag) this service runs (T-0016-1's image)."
  type        = string
}

variable "port" {
  description = "Port the container listens on -- must match $PORT read by the Dockerfile's CMD (AC1)."
  type        = string
  default     = "8000"
}

variable "cpu" {
  description = "App Runner instance CPU, in vCPU units as a string (e.g. \"1024\" = 1 vCPU). Module input, not a literal (AC1/AC10)."
  type        = string
  default     = "1024"
}

variable "memory" {
  description = "App Runner instance memory, in MB as a string (e.g. \"2048\" = 2 GB). Module input, not a literal (AC1/AC10) -- T-0016-9 raises this from measurement."
  type        = string
  default     = "2048"
}

variable "access_role_arn" {
  description = "Role App Runner assumes to pull the image from ECR and write build logs (pull_log_role)."
  type        = string
}

variable "instance_role_arn" {
  description = "Role the running container assumes -- the panel-bucket application identity (app_role)."
  type        = string
}

variable "auto_deployments_enabled" {
  description = <<-EOT
    Whether App Runner redeploys automatically when a new image is pushed to
    the same tag `image_identifier` references. Default false: this
    deployment tags images by immutable git SHA (the ECR repository itself
    enforces tag immutability), so a given `image_identifier` value is never
    repushed -- a new commit always means a new tag, which requires a
    Terraform apply to change `image_identifier` regardless. Auto-deploy
    would therefore never fire in ordinary use; leaving it off keeps every
    deployment an explicit, auditable Terraform change rather than a side
    effect of a registry push (AC8).
  EOT
  type        = bool
  default     = false
}

variable "health_check_path" {
  description = "HTTP path App Runner probes (T-0016-2's liveness endpoint, AC3)."
  type        = string
  default     = "/health"
}

variable "health_check_interval_seconds" {
  description = <<-EOT
    Seconds between health check attempts (AWS range: 1-20). Set to the
    maximum (20): startup blocks on downloading and parsing the panel from
    S3 before the process answers HTTP at all, so probing needs to be as
    infrequent as AWS allows rather than tuned for a warm process (see
    unhealthy_threshold for the actual startup budget this buys).
  EOT
  type        = number
  default     = 20
}

variable "health_check_timeout_seconds" {
  description = "Seconds to wait for a single probe response (AWS range: 1-20). Below the interval, generous enough for a slow individual request under real network conditions."
  type        = number
  default     = 15
}

variable "health_check_healthy_threshold" {
  description = "Consecutive successes to mark an instance healthy (AWS range: 1-20). 1: once the process answers, it is genuinely up (AC3)."
  type        = number
  default     = 1
}

variable "health_check_unhealthy_threshold" {
  description = <<-EOT
    Consecutive failures before an instance is marked unhealthy and
    recycled (AWS range: 1-20). Set to 10 so that, paired with the 20s
    interval, a new instance gets ~200s to download and parse the panel
    from S3 before startup blocks health checks long enough to look dead.
    The default pairing (5s interval x 5-failure threshold = ~25s) is not
    remotely enough -- getting this wrong presents as a deployment that
    rolls itself back forever with nothing in the application logs (the
    process never gets far enough to log anything).
  EOT
  type        = number
  default     = 10
}

variable "environment_variables" {
  description = "Non-secret runtime environment variables (AC5)."
  type        = map(string)
  default     = {}
}

variable "environment_secrets" {
  description = "Runtime environment variables sourced from SSM/Secrets Manager by ARN reference, never by value (AC6)."
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  description = "Explicit CloudWatch Logs retention for this service's application and service log groups (AC7). AWS's own App Runner-managed log groups default to never-expire without this."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Common tags merged into every resource this module creates."
  type        = map(string)
  default     = {}
}
