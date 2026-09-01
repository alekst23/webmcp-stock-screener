# T-0016-4: Terraform foundation — network, bucket, registry, IAM

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open
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

This ticket lays the substrate that is independent of which compute platform
is chosen, so that the Fargate-vs-App-Runner question (epic Open Question 2)
does not block it: a network, the panel bucket, somewhere to put the image,
and the roles that let a task read the bucket and its secrets.

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
