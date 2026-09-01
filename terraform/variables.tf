variable "region" {
  description = "AWS region for every resource in this configuration (AC9)."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name for every resource in this configuration (AC9)."
  type        = string
  default     = "prod"
}
