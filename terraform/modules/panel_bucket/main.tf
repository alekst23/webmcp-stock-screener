# The panel and universe-metadata bucket (AC5). Versioned because the
# nightly delta (T-0016-8) rewrites the whole panel object in place -- a bad
# run without versioning is unrecoverable except by paying EODHD for another
# backfill (see the ticket's Technical Considerations).

locals {
  bucket_name = "webmcp-panel-${var.environment}-${var.account_id}"

  common_tags = merge(var.tags, {
    Environment = var.environment
    Name        = local.bucket_name
  })
}

resource "aws_s3_bucket" "panel" {
  bucket = local.bucket_name

  tags = local.common_tags
}

resource "aws_s3_bucket_versioning" "panel" {
  bucket = aws_s3_bucket.panel.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "panel" {
  bucket = aws_s3_bucket.panel.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "panel" {
  bucket = aws_s3_bucket.panel.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
