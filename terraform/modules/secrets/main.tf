# The one runtime secret left after T-0016-3 moved object-store auth onto
# the app role's default credential chain (AC1). SSM Parameter Store over
# Secrets Manager -- standard-tier SecureString is free and needs no
# rotation Lambda this project has no use for; see the ticket's Solution
# Approach for the full argument.
#
# `value` is a placeholder only -- Terraform creates the parameter, it never
# writes the real key. The real value is set out-of-band with `aws ssm
# put-parameter --overwrite` (docs/reference/aws-secrets.md) after apply.
# `ignore_changes` keeps a later plan/apply from either clobbering that
# out-of-band value or pulling it back into state (AC2, AC5): rotating the
# value in AWS takes effect on the next task start with no Terraform action.
resource "aws_ssm_parameter" "eodhd_api_key" {
  name        = "/webmcp/${var.environment}/eodhd-api-key"
  description = "EODHD API key -- paid plan, 100k-unit daily quota. Value is set out-of-band; never managed by Terraform."
  type        = "SecureString"
  value       = "REPLACE_ME_VIA_AWS_CLI"

  tags = merge(var.tags, {
    Environment = var.environment
  })

  lifecycle {
    ignore_changes = [value]
  }
}

# The default AWS-managed SSM key. Not created here -- it already exists in
# this account -- just referenced so the read grant below can be scoped to
# it instead of "kms:*" on every key.
data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

# Least-privilege read (AC4): the app role may read exactly this one
# parameter and decrypt it with exactly the key it's encrypted under --
# nothing else in Parameter Store or KMS.
data "aws_iam_policy_document" "app_read_eodhd_api_key" {
  statement {
    sid       = "EodhdApiKeyRead"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.eodhd_api_key.arn]
  }

  statement {
    sid       = "EodhdApiKeyDecrypt"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
  }
}

resource "aws_iam_role_policy" "app_read_eodhd_api_key" {
  name   = "webmcp-${var.environment}-secrets-read-policy"
  role   = var.app_role_name
  policy = data.aws_iam_policy_document.app_read_eodhd_api_key.json
}
