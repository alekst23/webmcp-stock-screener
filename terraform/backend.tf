# Empty on purpose -- Terraform's backend block cannot take variables or
# data sources, so the actual bucket/key/region come from backend.hcl via
# `terraform init -backend-config=backend.hcl` (see terraform/README or the
# bootstrap module for how backend.hcl's values are produced).
terraform {
  backend "s3" {}
}
