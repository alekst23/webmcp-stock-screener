# T-0016-6: the long-running HTTPS service that replaces render.yaml's
# `web` service. App Runner (not ECS/Fargate) per the epic's Resolved
# Decisions -- see docs/plan/EPIC-0016/_epic.md and this ticket's Solution
# Approach for why. It gives HTTPS termination, a stable hostname, and
# rolling deploy-with-rollback for free; this module's job is everything
# App Runner does NOT do for free: an explicit memory/CPU allocation
# (AC1), a health-check timing that tolerates the slow S3-backed startup
# (AC3/AC4), and an explicit log retention (AC7) App Runner's own
# auto-created log groups don't have.

locals {
  service_name = "webmcp-${var.environment}-api"

  common_tags = merge(var.tags, {
    Environment = var.environment
  })
}

# Pinned to exactly one instance, always. App Runner's own default
# autoscaling configuration allows up to 25 -- fine for a stateless service,
# wrong for this one: the whole design holds one panel resident in memory
# per instance (T-0016-6's Out of Scope), so scaling out multiplies the
# panel rather than sharing it. Pinning here makes that a property of the
# infrastructure, not just a documented intent nobody enforces.
resource "aws_apprunner_auto_scaling_configuration_version" "fixed_single" {
  auto_scaling_configuration_name = "webmcp-${var.environment}-fixed-single"
  min_size                        = 1
  max_size                        = 1
  max_concurrency                 = 100

  tags = local.common_tags
}

resource "aws_apprunner_service" "this" {
  service_name = local.service_name

  source_configuration {
    auto_deployments_enabled = var.auto_deployments_enabled

    authentication_configuration {
      access_role_arn = var.access_role_arn
    }

    image_repository {
      image_identifier      = var.image_identifier
      image_repository_type = "ECR"

      image_configuration {
        port                          = var.port
        runtime_environment_variables = var.environment_variables
        runtime_environment_secrets   = var.environment_secrets
      }
    }
  }

  instance_configuration {
    cpu               = var.cpu
    memory            = var.memory
    instance_role_arn = var.instance_role_arn
  }

  # AC3/AC4: liveness only (T-0016-2's /health -- no file read, no
  # object-store call, no panel computation), timed to tolerate the panel
  # download+parse that blocks startup rather than a warm process. See
  # variables.tf for the interval/threshold reasoning.
  health_check_configuration {
    protocol            = "HTTP"
    path                = var.health_check_path
    interval            = var.health_check_interval_seconds
    timeout             = var.health_check_timeout_seconds
    healthy_threshold   = var.health_check_healthy_threshold
    unhealthy_threshold = var.health_check_unhealthy_threshold
  }

  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.fixed_single.arn

  tags = local.common_tags
}

# AC7: explicit retention. App Runner auto-creates these two log groups the
# moment the service starts building/running, with "never expire" retention
# -- Terraform cannot create them ahead of time because their name embeds
# `service_id`, which AWS assigns only once the service exists, and by the
# time this resource's dependency (service_id) is known, App Runner has
# already created both groups itself. Declaring them here documents the
# intended retention and lets `terraform import` (run once, by hand, after
# the service's first apply -- see the module README / T-0016-6's
# verification notes) bring them under Terraform management without a
# create-time conflict; every apply after that import reconciles
# retention_in_days like any other managed resource.
resource "aws_cloudwatch_log_group" "application" {
  name              = "/aws/apprunner/${local.service_name}/${aws_apprunner_service.this.service_id}/application"
  retention_in_days = var.log_retention_days

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "service" {
  name              = "/aws/apprunner/${local.service_name}/${aws_apprunner_service.this.service_id}/service"
  retention_in_days = var.log_retention_days

  tags = local.common_tags
}
