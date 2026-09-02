# T-0016-4: Terraform foundation — network, bucket, registry, IAM

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Done -- 17 resources applied live against the real account with a clean second plan; merged to `main` 2026-09-02
**Depends on**: —
**Blocks**: T-0016-5, T-0016-6, T-0016-7
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

Render needed no infrastructure description beyond `render.yaml`, so there is
none in this repo: no Terraform, no state backend, no account or region
recorded anywhere. Everything downstream in this epic — the service, the
scheduled job, the secrets, the object migration — needs somewhere to be
created and an identity to act as.

This ticket lays the substrate every other ticket needs: remote state, the
panel bucket, somewhere to put the image, and the roles that let a workload
read the bucket and its secrets.

The compute platform is now settled — **App Runner for the API, an
EventBridge-scheduled Fargate task for the nightly job** — and that settles
the network scope, which is the one place this ticket could have
over-built. App Runner needs no VPC at all: it reaches S3 and EODHD over the
public internet. The nightly Fargate task does need a VPC, but only a
minimal one — public subnets with an internet gateway and
`assign_public_ip`, so its egress needs no NAT gateway. **Provision no NAT
gateway.** It is ~$32/month for a job that runs for a few minutes a night,
and it is the single easiest way to make this migration cost more than the
Render bill it replaces.

Done looks like: `terraform apply` from a clean state produces an empty but
correct account footprint, and a second apply reports no changes.

## User Story

As the person operating this,
I want the AWS footprint described as code from the first resource,
so that the deployment can be recreated, reviewed, and destroyed without
anyone reconstructing it from memory or a dashboard.

## Acceptance Criteria

1. Infrastructure is organized as reusable modules composed by a root
   configuration, rather than one flat file of resources.
2. `terraform fmt` reports no changes, and all resource and variable names
   are `snake_case`.
3. State is stored remotely with locking, so two applies cannot race.
4. A clean `terraform apply` succeeds with no manual console step, and an
   immediate second `plan` reports no drift.
5. A private object-storage bucket exists for the panel and universe
   metadata, with public access blocked, versioning enabled, and encryption
   at rest.
6. A private image registry exists for the backend image, and its lifecycle
   policy prevents unbounded accumulation of untagged images.
7. Two distinct execution identities exist: one permitting only image pull
   and log writes, and one granting the running application read and write on
   the panel bucket and nothing else.
8. The bucket policy grants only the object operations the application
   actually performs, scoped to that bucket, with no wildcard resource.
9. Region and environment name are inputs, not literals, and no account ID,
   credential, or secret value is committed.
10. The network contains no NAT gateway and no other resource billed per
    hour that is not required by a workload this epic actually deploys.

## Solution Approach

### Module layout (AC1, AC2)

```
terraform/
  bootstrap/            # one-time, local state — creates the remote state bucket
  modules/
    network/             # VPC, 2 public subnets (2 AZs), IGW, route table — no NAT
    panel_bucket/         # the S3 bucket AC5/AC8 describe
    registry/             # ECR repository + lifecycle policy (AC6)
    iam/                   # the two execution identities (AC7/AC8)
  main.tf, variables.tf, outputs.tf, backend.tf, backend.hcl
```

The root configuration composes the four modules; nothing lives as a bare
resource outside a module. Every `.tf` file is `terraform fmt`-clean and
every resource/variable identifier is `snake_case` (AC2); AWS-side name
*values* use hyphens where the service requires it (S3 bucket names reject
underscores).

### Remote state bootstrap (AC3)

Terraform's `backend` block cannot reference variables or data sources —
this is a hard tool limitation, not a design choice, so it is the one place
literal configuration is unavoidable. `terraform/bootstrap/` is a small,
separately-applied configuration with **local** state that creates only the
state bucket (versioned, encrypted, public access blocked) and nothing else.
Its bucket name is built from `data.aws_caller_identity.current.account_id`
(resolved at apply time, never a hardcoded digit string) so it is
collision-free without a committed account ID literal. The resolved name is
then written once into a committed `terraform/backend.hcl` (bucket, key,
region, `use_lockfile = true` — Terraform 1.10's native S3 state locking,
verified against the installed 1.10.2, so no DynamoDB lock table is needed)
and the root config is initialized with
`terraform init -backend-config=backend.hcl`. `backend.hcl` holds no
credential or secret — only a bucket name, key, and region — so committing
it does not violate AC9.

### Least-privilege bucket policy (AC8)

`backend/infra/object_store.py` calls exactly three S3 operations:
`head_object`, `get_object`, `put_object`. `HeadObject` and `GetObject` both
require the `s3:GetObject` IAM action (AWS documents `HeadObject` as covered
by `s3:GetObject`, not a separate permission), and `PutObject` requires
`s3:PutObject`. No `s3:ListBucket`, no `s3:Delete*`, no bucket-level action
is granted. `backend/application/load_panel.py` defines the only two keys
ever touched — `panel.parquet` and `universe.csv` — so the policy's
`Resource` is the two exact object ARNs (`{bucket_arn}/panel.parquet`,
`{bucket_arn}/universe.csv`) rather than `{bucket_arn}/*`: AC8's "no
wildcard resource" is read literally, not just as "no `Resource: \"*\"`".
The two keys are a module variable (default matches the constants above),
not a hardcoded list, so a future third object doesn't require editing the
policy's shape.

### Two execution identities (AC7)

Both are IAM roles with multi-principal trust policies, because T-0016-6
(App Runner) and T-0016-8 (Fargate) both need a "pull + log" identity and an
"application" identity, and the two platforms use different service
principals for equivalent roles:

- `pull_log_role` — trusted by `build.apprunner.amazonaws.com` (App
  Runner's ECR access role) and `ecs-tasks.amazonaws.com` (ECS's task
  execution role). Grants `ecr:GetAuthorizationToken` (resource `*` — this
  ECR action has no resource-level permission support, unrelated to AC8's
  bucket-policy constraint), `ecr:BatchCheckLayerAvailability` /
  `GetDownloadUrlForLayer` / `BatchGetImage` scoped to the one registry
  ARN, and `logs:CreateLogGroup` / `CreateLogStream` / `PutLogEvents`
  scoped to `/aws/apprunner/webmcp-*` and `/ecs/webmcp-*` log-group ARNs.
  (App Runner's access role never actually calls the logs actions — App
  Runner writes its own logs through an AWS-managed path — but ECS's task
  execution role does, so the grant is real for the identity that needs it
  and inert for the one that doesn't.)
- `app_role` — trusted by `tasks.apprunner.amazonaws.com` (App Runner's
  instance role) and `ecs-tasks.amazonaws.com` (ECS's task role). Grants
  only the two `s3:GetObject`/`s3:PutObject` statements above. Nothing
  else — this is the identity T-0016-3's credential-chain path resolves to
  in the running container.

Both roles are Terraform outputs (ARNs) for T-0016-6 and T-0016-8 to attach
without re-deriving them.

### Network (AC10)

A dedicated VPC rather than the account's existing default VPC
(`vpc-063760560ae7c1b5a`, which already carries the `database-1` RDS
instance and unrelated non-epic workloads): two public subnets in two AZs,
one internet gateway, one route table with a `0.0.0.0/0` route to it,
`map_public_ip_on_launch = true`. No NAT gateway, no Elastic IP, no VPC
endpoint — nothing in this footprint bills per hour. This is deliberately
separate from the default VPC so every network resource this epic owns is
tagged, destroyable, and cannot affect the unrelated workloads already
running there; reaching RDS later is a VPC-peering or connector decision for
whoever adds Postgres; using the region correctly is what AC1 of the
Resolved Decisions table asked for, not sharing the VPC.

### Environment and region as inputs (AC9)

`variable "region"` (default `us-east-1`) and `variable "environment"`
(default `prod` — this footprint replaces the live Render deployment, there
is no separate staging environment) are threaded through every module. The
`aws` provider block sets no `profile` — the operator's `AWS_PROFILE`
environment variable supplies credentials, so no account/profile literal
sits in committed HCL. Account ID appears in code only via
`data.aws_caller_identity.current`, never as a digit literal.

## Design References

- `backend/infra/object_store.py` — the exact S3 operations the application
  performs (`head_object`, `get_object`, `put_object`), which AC8's policy is
  scoped to
- `backend/application/load_panel.py` — the two object keys the bucket must
  hold: the panel and the universe CSV
- `render.yaml` — the two services being replaced, whose environment
  contracts define what the roles in AC7 must eventually reach
- Project standards: Terraform formatted with `terraform fmt`, module-based
  structure, `snake_case` HCL naming

## Technical Considerations

**Region is an open question** (epic Open Question 1) and nothing in the repo
answers it. The recommended default is to match the region of the existing
paid infrastructure — the RDS/Aurora cluster in particular — so a later
Postgres adapter or server-side workspace store does not cross regions. AC9
makes region an input precisely so this is a variable value rather than a
rewrite.

The network can be minimal. This epic runs one HTTP service and one nightly
batch job, neither of which needs to reach the database. Public subnets with
tasks that have no inbound path except through the load balancer are simpler
and cheaper than private subnets plus a NAT gateway, and the NAT gateway is a
real recurring cost for a POC. If the recommended region is the one holding
RDS, note whether the VPC should be the existing one instead of a new one —
that decision belongs here rather than to whoever adds Postgres later.

AC7 keeps the pull/log identity separate from the application identity
because they have different blast radii, and because T-0016-3's
credential-chain path means the application identity is the only thing
standing between the service and the panel data.

Versioning on the bucket (AC5) is not bureaucracy: the nightly delta rewrites
the whole panel object in place, so a bad run without versioning is
unrecoverable except by paying EODHD for another backfill.

## Out of Scope

The compute service and task definition (T-0016-6). The scheduled job
(T-0016-8). Secret values and their storage (T-0016-5). Anything to do with
RDS/Aurora — it is available and already paid for, but nothing in this epic
uses it.
