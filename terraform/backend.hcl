# Partial backend configuration for `terraform init -backend-config=backend.hcl`.
# No secret or credential here -- only the state bucket produced by
# terraform/bootstrap (see its outputs), the state's object key, the region,
# and use_lockfile (Terraform 1.10's native S3 state locking -- no DynamoDB
# lock table needed, satisfies AC3 without an extra resource).
bucket       = "webmcp-tfstate-prod-490284589142"
key          = "webmcp-replatform/terraform.tfstate"
region       = "us-east-1"
encrypt      = true
use_lockfile = true
