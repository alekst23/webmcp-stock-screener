# Private image registry (AC6). One repository holds the single image that
# runs both the API (App Runner, T-0016-6) and the nightly job (Fargate,
# T-0016-8) -- one image, one dependency closure.

resource "aws_ecr_repository" "backend" {
  name                 = "webmcp-backend-${var.environment}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

# Tagged images (the ones actually deployed) are kept indefinitely; only
# untagged images -- left behind by re-pushes to the same tag or failed
# pushes -- are bounded, so the registry cannot grow without limit (AC6).
resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images beyond the most recent 5"
        selection = {
          tagStatus   = "untagged"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
