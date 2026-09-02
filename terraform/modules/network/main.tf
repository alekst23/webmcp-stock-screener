# Minimal public-only network for the nightly Fargate task (T-0016-8). App
# Runner (T-0016-6) needs no VPC at all -- this module exists only because
# ECS Fargate tasks must run inside one. Public subnets with an internet
# gateway and assign_public_ip give the task's S3/EODHD egress a route with
# no NAT gateway, which is a real per-hour cost this epic does not need
# (AC10).
#
# A dedicated VPC rather than the account's existing default VPC: the
# default VPC already carries the database-1 RDS instance and unrelated
# non-epic workloads, and everything this epic creates must be tagged and
# independently destroyable without touching what's already there.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Two AZs is enough for a single-task nightly job; it costs nothing extra
  # and avoids a single-AZ failure mode.
  az_count = 2
  azs      = slice(data.aws_availability_zones.available.names, 0, local.az_count)

  common_tags = merge(var.tags, {
    Environment = var.environment
  })
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.common_tags, {
    Name = "webmcp-${var.environment}-vpc"
  })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name = "webmcp-${var.environment}-igw"
  })
}

resource "aws_subnet" "public" {
  count = local.az_count

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "webmcp-${var.environment}-public-${local.azs[count.index]}"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(local.common_tags, {
    Name = "webmcp-${var.environment}-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  count = local.az_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
