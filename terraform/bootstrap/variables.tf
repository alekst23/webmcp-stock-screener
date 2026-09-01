variable "region" {
  description = "AWS region to create the state bucket in."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name embedded in the state bucket name."
  type        = string
  default     = "prod"
}
