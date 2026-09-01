# The two execution identities (AC7). Both are trusted by two service
# principals because T-0016-6 (App Runner) and T-0016-8 (Fargate) each need
# a "pull + log" identity and an "application" identity, and the two
# platforms use different principals for the equivalent role:
#
#   pull_log_role : build.apprunner.amazonaws.com (App Runner access role)
#                   ecs-tasks.amazonaws.com        (ECS task execution role)
#   app_role      : tasks.apprunner.amazonaws.com  (App Runner instance role)
#                   ecs-tasks.amazonaws.com        (ECS task role)
#
# Different blast radii, per the ticket: pull_log_role can read the
# registry and write logs and nothing else; app_role can read and write the
# panel bucket and nothing else. app_role is the only thing standing between
# the running service and the panel data (T-0016-3's credential-chain path).

data "aws_iam_policy_document" "pull_log_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["build.apprunner.amazonaws.com", "ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "pull_log" {
  name               = "webmcp-${var.environment}-pull-log-role"
  assume_role_policy = data.aws_iam_policy_document.pull_log_trust.json

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

data "aws_iam_policy_document" "pull_log_permissions" {
  statement {
    sid       = "EcrAuth"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # ECR API restriction: this action has no resource-level permission.
  }

  statement {
    sid    = "EcrPull"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
    resources = [var.registry_repository_arn]
  }

  statement {
    sid    = "LogWrite"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/apprunner/webmcp-*",
      "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/apprunner/webmcp-*:*",
      "arn:aws:logs:${var.region}:${var.account_id}:log-group:/ecs/webmcp-*",
      "arn:aws:logs:${var.region}:${var.account_id}:log-group:/ecs/webmcp-*:*",
    ]
  }
}

resource "aws_iam_role_policy" "pull_log" {
  name   = "webmcp-${var.environment}-pull-log-policy"
  role   = aws_iam_role.pull_log.id
  policy = data.aws_iam_policy_document.pull_log_permissions.json
}

data "aws_iam_policy_document" "app_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["tasks.apprunner.amazonaws.com", "ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "webmcp-${var.environment}-app-role"
  assume_role_policy = data.aws_iam_policy_document.app_trust.json

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

# Scoped to exactly the two object keys load_panel.py reads and
# nightly_delta.py writes (AC8) -- not "${bucket_arn}/*". No
# s3:ListBucket, no delete action: object_store.py never calls them.
data "aws_iam_policy_document" "app_permissions" {
  statement {
    sid       = "PanelObjectReadWrite"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = [for key in var.panel_object_keys : "${var.panel_bucket_arn}/${key}"]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "webmcp-${var.environment}-app-policy"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app_permissions.json
}
