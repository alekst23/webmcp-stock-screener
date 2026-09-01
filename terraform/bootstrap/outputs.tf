output "state_bucket_name" {
  description = "Copy this into ../backend.hcl's bucket value."
  value       = aws_s3_bucket.tfstate.bucket
}

output "state_bucket_arn" {
  value = aws_s3_bucket.tfstate.arn
}
