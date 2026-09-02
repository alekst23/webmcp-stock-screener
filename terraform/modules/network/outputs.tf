output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "For the Fargate task definition's network configuration (T-0016-8)."
  value       = aws_subnet.public[*].id
}
