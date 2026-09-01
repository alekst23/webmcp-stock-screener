variable "environment" {
  description = "Environment name, used in the bucket name and tags."
  type        = string
}

variable "account_id" {
  description = "Caller account ID, used only to make the bucket name globally unique."
  type        = string
}

variable "tags" {
  description = "Common tags merged into every resource this module creates."
  type        = map(string)
  default     = {}
}
