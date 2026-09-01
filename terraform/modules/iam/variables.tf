variable "environment" {
  description = "Environment name, used in role names and tags."
  type        = string
}

variable "region" {
  description = "Region, used to scope the log-group ARNs in the pull/log policy."
  type        = string
}

variable "account_id" {
  description = "Caller account ID, used to scope the log-group ARNs in the pull/log policy."
  type        = string
}

variable "registry_repository_arn" {
  description = "ECR repository ARN the pull/log role is scoped to."
  type        = string
}

variable "panel_bucket_arn" {
  description = "Panel bucket ARN the app role is scoped to."
  type        = string
}

variable "panel_object_keys" {
  description = "Exact object keys the app role may read/write -- matches load_panel.py's PANEL_KEY and UNIVERSE_KEY."
  type        = list(string)
  default     = ["panel.parquet", "universe.csv"]
}

variable "tags" {
  description = "Common tags merged into every resource this module creates."
  type        = map(string)
  default     = {}
}
