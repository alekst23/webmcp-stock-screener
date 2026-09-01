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

# --- T-0016-6: App Runner service inputs -----------------------------------

variable "apprunner_image_tag" {
  description = "Immutable ECR tag of the T-0016-1 image to deploy (e.g. a git short SHA). No default -- a deploy is an explicit, auditable choice of tag, not an implicit 'whatever was last pushed'."
  type        = string
}

variable "apprunner_cpu" {
  description = "App Runner instance vCPU units, as a string (T-0016-6 AC1/AC10). Pinned at 1 vCPU per the epic's Resolved Decisions."
  type        = string
  default     = "1024"
}

variable "apprunner_memory" {
  description = "App Runner instance memory in MB, as a string (T-0016-6 AC1/AC10). 2 GB per the epic's Resolved Decisions -- T-0016-9 raises this from measurement, not argument."
  type        = string
  default     = "2048"
}

variable "apprunner_port" {
  description = "Port the container listens on -- matches the Dockerfile CMD's $PORT."
  type        = string
  default     = "8000"
}

variable "cors_allowed_origins" {
  description = "CORS_ALLOWED_ORIGINS equivalent to render.yaml's (AC5). Defaults to the current live frontend origin (docs/reference/deployment.md); T-0016-10 repoints the frontend itself."
  type        = string
  default     = "https://webmcp-stock-screener.alekst23.workers.dev"
}

variable "rate_limit_default" {
  description = "RATE_LIMIT_DEFAULT equivalent to render.yaml's committed value (AC5)."
  type        = string
  default     = "60/minute"
}

variable "require_real_panel" {
  description = <<-EOT
    REQUIRE_REAL_PANEL equivalent to render.yaml's production value (AC5).
    True is safe even while the panel bucket may still be empty (T-0016-7's
    backfill in progress): the guard only refuses startup when NO bucket is
    configured at all (OBJECT_STORE_BUCKET unset). With a bucket configured
    but empty of panel.parquet, load_panel falls through to the mock panel
    exactly as it does today, unaffected by this flag -- see
    backend/application/load_panel.py. A wrong bucket or denied permission
    still fails startup loudly either way, via ensure_reachable(), which is
    the actual hazard T-0016-12 exists to close.
  EOT
  type        = bool
  default     = true
}
