variable "environment" {
  description = "Environment name, used in the parameter path and tags."
  type        = string
}

variable "app_role_name" {
  description = "Name of the application IAM role (terraform/modules/iam), granted read access to the EODHD API key parameter."
  type        = string
}

variable "tags" {
  description = "Common tags merged into every resource this module creates."
  type        = map(string)
  default     = {}
}
