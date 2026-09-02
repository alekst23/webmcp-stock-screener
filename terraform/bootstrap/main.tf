# One-time, locally-stated bootstrap. This is the one Terraform config in
# this repo that is NOT stored remotely, because it creates the bucket the
# rest of the repo's remote state lives in -- state cannot describe its own
# storage. Apply this once per account/environment, copy the resulting
# bucket name into ../backend.hcl, then never touch it again except to
# recreate the state store from scratch.

terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}

locals {
  # Account ID makes the name globally unique without a committed literal --
  # it is resolved at apply time from the data source, never typed in HCL.
  state_bucket_name = "webmcp-tfstate-${var.environment}-${data.aws_caller_identity.current.account_id}"

  common_tags = {
    Project     = "webmcp-stock-screener"
    Epic        = "aws-replatform"
    Environment = var.environment
    ManagedBy   = "terraform-bootstrap"
  }
}

resource "aws_s3_bucket" "tfstate" {
  bucket = local.state_bucket_name

  tags = merge(local.common_tags, {
    Name = local.state_bucket_name
  })
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
