terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# No `profile` argument: the operator's AWS_PROFILE environment variable
# supplies credentials, so no account/profile literal sits in committed HCL.
provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}

locals {
  common_tags = {
    Project     = "webmcp-stock-screener"
    Epic        = "EPIC-0016"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

module "network" {
  source = "./modules/network"

  environment = var.environment
  tags        = local.common_tags
}

module "panel_bucket" {
  source = "./modules/panel_bucket"

  environment = var.environment
  account_id  = data.aws_caller_identity.current.account_id
  tags        = local.common_tags
}

module "registry" {
  source = "./modules/registry"

  environment = var.environment
  tags        = local.common_tags
}

module "iam" {
  source = "./modules/iam"

  environment             = var.environment
  region                  = var.region
  account_id              = data.aws_caller_identity.current.account_id
  registry_repository_arn = module.registry.repository_arn
  panel_bucket_arn        = module.panel_bucket.bucket_arn
  tags                    = local.common_tags
}

module "secrets" {
  source = "./modules/secrets"

  environment   = var.environment
  app_role_name = module.iam.app_role_name
  tags          = local.common_tags
}

module "apprunner_service" {
  source = "./modules/apprunner_service"

  environment = var.environment
  region      = var.region
  account_id  = data.aws_caller_identity.current.account_id

  image_identifier = "${module.registry.repository_url}:${var.apprunner_image_tag}"
  port             = var.apprunner_port
  cpu              = var.apprunner_cpu
  memory           = var.apprunner_memory

  access_role_arn   = module.iam.pull_log_role_arn
  instance_role_arn = module.iam.app_role_arn

  # Every environment value the Render web service carried (AC5). No
  # OBJECT_STORE_ACCESS_KEY_ID/SECRET_ACCESS_KEY: the app role's default
  # credential chain replaces static keys entirely (decision 5).
  environment_variables = {
    CORS_ALLOWED_ORIGINS = var.cors_allowed_origins
    RATE_LIMIT_DEFAULT   = var.rate_limit_default
    REQUIRE_REAL_PANEL   = var.require_real_panel ? "true" : "false"
    OBJECT_STORE_BUCKET  = module.panel_bucket.bucket_name
    OBJECT_STORE_REGION  = var.region
  }

  environment_secrets = {
    EODHD_API_KEY = module.secrets.eodhd_api_key_parameter_arn
  }

  tags = local.common_tags
}
