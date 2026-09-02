# T-0016-8: EventBridge Scheduler rule invoking a standalone ECS Fargate
# task, on the same image and roles as the App Runner API. No long-running
# service, no load balancer, no NAT gateway -- an empty cluster and an
# unused task definition are free, and the task runs in T-0016-4's public
# subnets with an assigned public IP, so its S3/EODHD egress needs no paid
# gateway. See this ticket's Solution Approach for the full reasoning,
# including why the scheduler rule is applied disabled (AC9).

locals {
  name_prefix = "webmcp-${var.environment}-nightly"

  common_tags = merge(var.tags, {
    Environment = var.environment
  })
}

# No long-running service is ever placed on this cluster -- it exists only
# so RunTask has somewhere to launch into. Empty clusters are free.
resource "aws_ecs_cluster" "nightly" {
  name = "${local.name_prefix}-cluster"

  tags = local.common_tags
}

resource "aws_ecs_cluster_capacity_providers" "nightly" {
  cluster_name       = aws_ecs_cluster.nightly.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
  }
}

resource "aws_cloudwatch_log_group" "nightly_delta" {
  # Matches the "/ecs/webmcp-*" pattern the shared pull_log role's policy
  # (terraform/modules/iam) already authorizes -- no IAM change needed here.
  name              = "/ecs/${local.name_prefix}-delta"
  retention_in_days = var.log_retention_days

  tags = local.common_tags
}

# No ingress at all -- the task never listens on anything, it only makes
# outbound HTTPS calls to S3 and EODHD. Egress-only, matching the "no NAT
# gateway" decision: a public subnet + assigned public IP is the route.
resource "aws_security_group" "nightly_delta" {
  name        = "${local.name_prefix}-delta-sg"
  description = "Egress-only SG for the nightly delta Fargate task (S3 + EODHD, no inbound)."
  vpc_id      = var.vpc_id

  egress {
    description = "All outbound HTTPS (S3, EODHD) -- no paid NAT gateway, public-subnet route only."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-delta-sg"
  })
}

# One task definition, one command baked in for the ordinary run. --catch-up
# is never baked in -- it is supplied per-invocation as a RunTask container
# override, so the recovery path (AC6) shares this exact definition and role
# rather than needing a second one.
resource "aws_ecs_task_definition" "nightly_delta" {
  family                   = "${local.name_prefix}-delta"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([
    {
      name      = "nightly-delta"
      image     = var.image_identifier
      essential = true
      # No `uv run` -- the runtime image's PATH already activates
      # /opt/venv (backend/Dockerfile), so this is the identical
      # `python scripts/nightly_delta.py` a local venv run would execute.
      command = ["python", "scripts/nightly_delta.py"]

      environment = [
        { name = "OBJECT_STORE_BUCKET", value = var.panel_bucket_name },
        { name = "OBJECT_STORE_REGION", value = var.region },
      ]

      secrets = [
        { name = "EODHD_API_KEY", valueFrom = var.eodhd_api_key_parameter_arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.nightly_delta.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "nightly-delta"
        }
      }
    }
  ])

  tags = local.common_tags
}

# Discovered live, not assumed: ECS resolves a task definition's `secrets`
# on the *execution* role at container launch, not the *task* role -- the
# mirror image of App Runner, which resolves `runtime_environment_secrets`
# on its *instance* role. The app/task role's SSM/KMS grant (modules/secrets,
# scoped to App Runner's instance role) does not cover this. Same
# least-privilege shape as that grant -- GetParameter/GetParameters (plural
# is what the platform's batch resolution actually calls) plus
# Decrypt/DescribeKey on the default SSM-managed KMS key -- attached to the
# execution role here rather than by editing modules/iam or modules/secrets.
data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

data "aws_iam_policy_document" "execution_read_eodhd_api_key" {
  statement {
    sid       = "EodhdApiKeyRead"
    effect    = "Allow"
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = [var.eodhd_api_key_parameter_arn]
  }

  statement {
    sid       = "EodhdApiKeyDecrypt"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:DescribeKey"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
  }
}

resource "aws_iam_role_policy" "execution_read_eodhd_api_key" {
  name   = "${local.name_prefix}-execution-secrets-read-policy"
  role   = var.execution_role_name
  policy = data.aws_iam_policy_document.execution_read_eodhd_api_key.json
}

# EventBridge Scheduler's own execution identity -- trusted by nothing but
# scheduler.amazonaws.com, and scoped to exactly the one action (RunTask on
# this task-definition family) and the two PassRole grants it needs to hand
# off to ECS. Deliberately created here, not appended to modules/iam: that
# module is shared with the live App Runner service and this ticket must
# not touch it.
data "aws_iam_policy_document" "scheduler_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler_invoke" {
  name               = "${local.name_prefix}-scheduler-role"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json

  tags = local.common_tags
}

data "aws_iam_policy_document" "scheduler_invoke_permissions" {
  statement {
    sid     = "RunNightlyDeltaTask"
    effect  = "Allow"
    actions = ["ecs:RunTask"]
    # Every revision of this one family, not "*" -- a new `terraform apply`
    # after an image bump creates a new revision the schedule must still be
    # able to launch.
    resources = ["${replace(aws_ecs_task_definition.nightly_delta.arn, "/:\\d+$/", "")}:*"]

    condition {
      test     = "ArnLike"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.nightly.arn]
    }
  }

  statement {
    sid       = "PassTaskRolesToEcs"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [var.execution_role_arn, var.task_role_arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name   = "${local.name_prefix}-scheduler-policy"
  role   = aws_iam_role.scheduler_invoke.id
  policy = data.aws_iam_policy_document.scheduler_invoke_permissions.json
}

resource "aws_scheduler_schedule" "nightly_delta" {
  name = "${local.name_prefix}-delta-schedule"

  # AC9: applied disabled while Render's cron is still the live scheduled
  # writer. See this ticket's Solution Approach -- flipped to ENABLED at
  # cutover (T-0016-10/T-0016-11), never both at once.
  state = var.schedule_enabled ? "ENABLED" : "DISABLED"

  schedule_expression = var.schedule_expression

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.nightly.arn
    role_arn = aws_iam_role.scheduler_invoke.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.nightly_delta.arn
      launch_type         = "FARGATE"

      network_configuration {
        subnets          = var.public_subnet_ids
        security_groups  = [aws_security_group.nightly_delta.id]
        assign_public_ip = true
      }
    }

    retry_policy {
      # A retried run is safe -- (ticker, date) dedupe (AC4) -- so a
      # transient EODHD/S3 hiccup is worth one retry before it counts as a
      # failed night.
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 3600
    }
  }
}
