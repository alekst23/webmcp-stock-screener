# AWS Secrets & Configuration (T-0016-5)

How the running deployment gets its runtime configuration, once EPIC-0016's
AWS re-platform is live. Written for someone with AWS account access
(`AWS_PROFILE=alekst23`, account `490284589142`, region `us-east-1`) and no
prior context.

## The short version

There is exactly **one secret**: the EODHD API key. Everything else the
service needs is ordinary, non-sensitive configuration passed as a plain
environment value on the App Runner service / ECS task definition
(T-0016-6 / T-0016-8), not a secret of any kind.

This is smaller than it looks at first because of a decision already made
in T-0016-3: object-storage authentication runs on the AWS default
credential chain (the task's own IAM role, `webmcp-prod-app-role`), so there
is no storage access key to store, rotate, or leak. `render.yaml`'s
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` have no AWS equivalent at all.

## Required values

| Variable | Kind | Value / where it lives | Notes |
|---|---|---|---|
| `EODHD_API_KEY` | **Secret** | SSM Parameter Store, `SecureString`, `/webmcp/prod/eodhd-api-key` | Read by `webmcp-prod-app-role` only. See "Populating the secret" below. |
| `OBJECT_STORE_BUCKET` | Config | `webmcp-panel-prod-490284589142` (Terraform output `panel_bucket_name`) | The bucket T-0016-4 created. |
| `OBJECT_STORE_REGION` | Config | `us-east-1` | Optional in principle (boto3 resolves it from the instance), set explicitly for clarity. |
| `RATE_LIMIT_DEFAULT` | Config | `60/minute` (or whatever the service is tuned to) | Same syntax as `backend/.env.example`. |
| `CORS_ALLOWED_ORIGINS` | Config | The deployed frontend's real origin | Never `*`. |
| `OBJECT_STORE_ENDPOINT_URL` | N/A | Left unset | Only needed for a non-AWS S3-compatible endpoint (R2). Production targets real S3. |
| `OBJECT_STORE_ACCESS_KEY_ID` / `OBJECT_STORE_SECRET_ACCESS_KEY` | N/A | Left unset | The task role supplies credentials via the default AWS credential chain. Setting these would *reintroduce* a static key path that T-0016-3 deliberately removed. |

`backend/infra/object_store.py` and `backend/.env.example` are the
authoritative source for what each object-store variable does; this table
only says where the value comes from in the AWS deployment.

## Where the Terraform lives

`terraform/modules/secrets/` — one `aws_ssm_parameter` (the key) and one
`aws_iam_role_policy` granting `webmcp-prod-app-role` exactly
`ssm:GetParameter` on that one parameter plus `kms:Decrypt` on the account's
default SSM key (`alias/aws/ssm`). Nothing broader. Outputs:
`eodhd_api_key_parameter_name` / `eodhd_api_key_parameter_arn`, for T-0016-6
and T-0016-8 to reference in the task's secret configuration.

The parameter is created with a placeholder value
(`REPLACE_ME_VIA_AWS_CLI`); Terraform never manages the real value
(`lifecycle { ignore_changes = [value] }` on the resource). This is
deliberate, not an oversight — see "Populating the secret" below.

## Populating the secret for the first time

The real key is never typed into Terraform, a `.tfvars` file, or any
committed file. Set it directly with the AWS CLI after `terraform apply`
has created the parameter:

```bash
export AWS_PROFILE=alekst23
export AWS_REGION=us-east-1

# Reads the key from stdin so it never appears in shell history or a
# process listing, and never touches disk.
printf '%s' 'the-real-eodhd-key' | aws ssm put-parameter \
  --name "/webmcp/prod/eodhd-api-key" \
  --type SecureString \
  --overwrite \
  --value file:///dev/stdin
```

If you have the key in a local `backend/.env` (the gitignored
local-development file) rather than typed at a prompt, pipe it through
instead of pasting the literal:

```bash
grep '^EODHD_API_KEY=' backend/.env | cut -d= -f2- | \
  aws ssm put-parameter --name "/webmcp/prod/eodhd-api-key" \
  --type SecureString --overwrite --value file:///dev/stdin \
  --region us-east-1 --profile alekst23
```

**Never** run `aws ssm put-parameter --value 'the-real-key' ...` with the
key as a literal argument — it lands in shell history and in `ps` output
while the command runs.

### Verifying without printing the value

```bash
aws ssm get-parameter --name "/webmcp/prod/eodhd-api-key" \
  --with-decryption --query 'Parameter.Value' --output text | wc -c
```

A non-zero length confirms the parameter is populated without ever
displaying it. To confirm it matches a known-good value, compare SHA-256
checksums computed locally (never print either raw value):

```bash
LOCAL_SHA=$(printf '%s' "$LOCAL_VALUE" | shasum -a 256)
REMOTE_SHA=$(aws ssm get-parameter --name "/webmcp/prod/eodhd-api-key" \
  --with-decryption --query 'Parameter.Value' --output text | shasum -a 256)
```

## Rotating the key

Re-run the same `put-parameter --overwrite` command with the new value. No
Terraform change, no redeploy needed for the parameter itself — the next
task start (App Runner instance replacement, or the next scheduled Fargate
run) reads the current value. `terraform plan` afterward reports no drift,
because Terraform was never told to manage the value.

## What's orphaned from Render

Render's `sync: false` fields never had a durable record beyond one
person's dashboard entries. On decommission (T-0016-11):

- `EODHD_API_KEY` — **not** orphaned. The same credential moves into the
  SSM parameter above; nothing to revoke.
- `CORS_ALLOWED_ORIGINS`, `R2_BUCKET_NAME`, `R2_ENDPOINT_URL` — never
  secrets, nothing to revoke.
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — the Cloudflare R2 API token
  pair Render used to authenticate to R2. **Orphaned.** Nothing on AWS uses
  or replaces it (the app role's credential chain is a different mechanism
  on a different provider). T-0016-11 must revoke this token in
  Cloudflare's dashboard (R2 → Manage R2 API Tokens) rather than leave it
  live with no consumer.

See `docs/plan/EPIC-0016/T-0016-5-secrets.md`'s Solution Approach for the
full reasoning behind the Parameter Store choice and the secret/config
split.
