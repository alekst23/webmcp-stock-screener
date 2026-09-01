variable "environment" {
  description = "Environment name, used in the repository name and tags."
  type        = string
}

variable "tags" {
  description = "Common tags merged into every resource this module creates."
  type        = map(string)
  default     = {}
}
