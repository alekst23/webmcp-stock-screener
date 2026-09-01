# T-0016-6: Terraform service module — container service and task definition

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open
**Depends on**: T-0016-1, T-0016-2, T-0016-3, T-0016-4
**Blocks**: T-0016-9, T-0016-10
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

This is where the 512 MB ceiling actually goes away: a long-running container
running the FastAPI service with an explicit memory allocation, reachable over
HTTPS. It replaces `render.yaml`'s `web` service — `webmcp-pattern-research-api`,
`plan: free`, region oregon — one for one, including its whole environment
contract.

The compute choice is the epic's second open question. **Recommendation: ECS
Fargate**, and the reasoning belongs here rather than in prose elsewhere:

- **App Runner cannot run the nightly job.** It serves HTTP and nothing else.
  Choosing it means T-0016-8 stands up ECS or Lambda anyway, so the project
  operates two platforms and App Runner's one advantage — less configuration —
  is spent. Fargate runs the API and the scheduled task from one task
  definition family, one image, one role, one log destination.
- **This epic is about a memory number.** Fargate states task memory
  explicitly and reports per-task utilization, so T-0016-9 measures against a
  ceiling it set. App Runner exposes memory as a coarser instance
  configuration.
- **The panel is a warm-up cost.** Startup downloads and parses the panel;
  the design's whole premise is that it then stays resident. A fixed desired
  count keeps it resident predictably.
- **RDS is in the picture eventually.** It is already paid for, and reaching a
  VPC from App Runner needs a connector — more moving parts, again cancelling
  the simplicity claim.

The honest cost of Fargate: materially more Terraform, and a load balancer
with a monthly charge. App Runner bundles HTTPS and a hostname for free. TLS
is not optional — the frontend is served over HTTPS from
`*.workers.dev`, so a plaintext backend origin would be blocked as mixed
content — so the choice is a load balancer, or App Runner, or some other
managed HTTPS front. Record whichever is chosen and its monthly cost.

Done looks like: the service running on AWS, healthy, serving the real panel,
with memory set to a number someone chose on purpose.

## User Story

As the deployed API,
I want to run as a long-running container with an explicit multi-gigabyte
memory allocation,
so that the engine can hold the panel resident and evaluate a complex pattern
without being killed for exceeding a free tier's cap.

## Acceptance Criteria

1. A long-running container service runs the API from the epic's image, at a
   stated CPU and memory allocation, and the allocation is a module input
   rather than a literal.
2. The service is reachable over HTTPS at a stable hostname from outside AWS.
3. Health probing targets the endpoint from T-0016-2, and a task that stops
   serving HTTP is replaced automatically.
4. A task whose panel is the mock fallback, or which has no panel at all,
   stays healthy and in service rather than being recycled.
5. Every environment value the Render web service carried has an equivalent:
   the EODHD key, allowed CORS origins, the rate limit, and the object-storage
   configuration.
6. Secrets reach the container by reference, and no secret value appears in
   the task definition.
7. Application logs from every task are collected to a single destination and
   retrievable by task, with a retention period set explicitly.
8. Deploying a new image version replaces tasks without dropping in-flight
   requests, and a failed deployment leaves the previous version serving.
9. The service reads the real panel from the bucket provisioned by the
   foundation module, using the application identity rather than static keys.
10. `terraform fmt` reports no changes; the module is composed by the root
    configuration and takes region, environment, image reference, and memory
    as inputs.

## Design References

- `render.yaml` — the `web` service being replaced: plan, region, start
  command, health check path, and all six environment variables
- `backend/main.py` — the lifespan hook that loads the panel once at startup
  (which is why the container must be long-running), CORS origin resolution
  from `CORS_ALLOWED_ORIGINS`, and the rate-limit default
- `docs/reference/deployment.md` — the live URLs the new origin joins
- T-0016-1 — the image and its default command
- T-0016-2 — the health endpoint AC3 probes and the reason for AC4
- T-0016-4 — the network, bucket, registry, and application identity

## Technical Considerations

**Memory is epic Open Question 3, recommended 4 GB.** Measured absolute peak
is 723 MB on a 2,000-ticker x 5-year panel with a realistic 3-step/4-study
pattern. That figure moves with expression complexity, not just row count —
the same panel measures +65% search growth going from a simple pattern to a
complex one — so headroom here is protecting against user input, not against
dataset growth. 2 GB is roughly 2.8x today's peak; 4 GB is what makes the
untrimmed 2,000 x 10-year universe viable, which is the reason the epic
exists. Set it as an input (AC1) so T-0016-9 can adjust it from measurement
rather than from argument.

Do not baseline-subtract when reasoning about this number. The container's
limit applies to the whole process — interpreter, libraries, application
imports, and data — which is exactly the correction the project's blocker
table records against the earlier 688 MB figure.

AC4 is the counterpart to T-0016-2's liveness-only decision, stated at the
infrastructure layer so the two cannot drift.

AC8 matters more than usual because startup is slow: a task is not useful
until the panel is downloaded and parsed. Whatever grace period the health
check allows must exceed real panel load time against S3, not against a local
file.

## Out of Scope

The scheduled nightly job (T-0016-8). Measuring memory (T-0016-9). Pointing
the frontend at the new origin (T-0016-10). Autoscaling policy — one task is
correct for a POC whose whole design is a resident in-memory panel, and
scaling out multiplies that panel per task rather than sharing it.
