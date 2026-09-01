# T-0016-6: Terraform service module — App Runner service at 2 GB

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

The compute choice is **settled: App Runner**, decided by the user on
2026-09-01 against this ticket's original Fargate recommendation. The full
reasoning on both sides is recorded in `_epic.md`'s Resolved Decisions; what
matters here is what it means for this module.

What App Runner gives this ticket for free, and therefore removes from its
scope entirely: HTTPS termination, a stable public hostname, a rolling
deployment with automatic rollback on a failed health check, and request
routing. There is no load balancer, no target group, no listener, no
certificate, and no NAT gateway — roughly $50/month of fixed infrastructure
that would have existed only to front a single container.

What it costs, and what this module must therefore do differently:

- **Memory is an instance-configuration size, not a task-level number.**
  App Runner takes CPU and memory as an instance configuration (`1 vCPU` /
  `2 GB` here). It reports request-level metrics but not per-task memory
  utilization the way ECS does, so **T-0016-9 measures peak RSS from inside
  the container** rather than reading a platform metric. That is the method
  the project's blocker table already mandates — absolute process RSS with no
  baseline subtraction — so nothing is lost, but AC1's memory input is the
  only lever, and it must stay an input.
- **The nightly job cannot live here.** App Runner serves HTTP only.
  T-0016-8 stands up a separate EventBridge-scheduled Fargate task on the
  same image. Both consume the same registry and the same application
  identity so their dependency closures cannot drift.
- **No VPC by default.** App Runner reaches S3 and EODHD over the public
  internet without a connector. A connector becomes necessary only if
  something later needs the VPC — RDS in particular — and nothing in this
  epic does.

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
2. The service is reachable over HTTPS at a stable hostname from outside
   AWS, with no certificate or DNS record managed by this repo.
3. Health probing targets the endpoint from T-0016-2 over HTTP, and an
   instance that stops serving is replaced automatically.
4. A task whose panel is the mock fallback, or which has no panel at all,
   stays healthy and in service rather than being recycled.
5. Every environment value the Render web service carried has an equivalent:
   the EODHD key, allowed CORS origins, the rate limit, and the object-storage
   configuration.
6. Secrets reach the container by reference, and no secret value appears in
   the task definition.
7. Application logs from every task are collected to a single destination and
   retrievable by task, with a retention period set explicitly.
8. Deploying a new image version replaces instances without dropping
   in-flight requests, and a deployment that fails its health check leaves
   the previous version serving. Auto-deploy on registry push is set
   deliberately one way or the other and the choice is recorded.
9. The service reads the real panel from the bucket provisioned by the
   foundation module, using the application identity rather than static keys.
10. `terraform fmt` reports no changes; the module is composed by the root
    configuration and takes region, environment, image reference, CPU, and
    memory as inputs.
11. The service's public hostname is a Terraform output, so T-0016-10 can
    consume it without anyone reading it off a console.

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

**Memory is settled at 2 GB**, decided by the user against this epic's 4 GB
recommendation. Measured absolute peak is 723 MB on a 2,000-ticker x 5-year
panel with a realistic 3-step/4-study pattern, and that figure moves with
expression complexity, not just row count — the same panel measures +65%
search growth going from a simple pattern to a complex one. 2 GB is roughly
2.8x today's peak, and the headroom is protecting against user input rather
than dataset growth. It is a genuine 4x removal of the 512 MB ceiling this
epic exists to clear; what it does not buy with confidence is the untrimmed
2,000 x 10-year universe.

Set it as an input (AC1) so T-0016-9 can raise it from measurement rather
than from argument. App Runner's supported pairings are coarse — at 1 vCPU
the choices are 2, 3, and 4 GB — so raising it later is a one-line change,
not a re-architecture. That is the mitigation, and it is the reason 2 GB is
a safe choice to start from rather than a gamble.

Do not baseline-subtract when reasoning about this number. The container's
limit applies to the whole process — interpreter, libraries, application
imports, and data — which is exactly the correction the project's blocker
table records against the earlier 688 MB figure.

AC4 is the counterpart to T-0016-2's liveness-only decision, stated at the
infrastructure layer so the two cannot drift.

AC8 matters more than usual because startup is slow: an instance is not
useful until the panel is downloaded and parsed. App Runner's health-check
configuration (interval, timeout, unhealthy threshold) must tolerate real
panel load time against S3, not against a local file — the default
20-second interval with a 3-failure threshold is unlikely to be enough, and
getting this wrong presents as a deployment that rolls itself back forever
with no error in the application logs.

## Out of Scope

The scheduled nightly job (T-0016-8). Measuring memory (T-0016-9). Pointing
the frontend at the new origin (T-0016-10). Autoscaling policy — one task is
correct for a POC whose whole design is a resident in-memory panel, and
scaling out multiplies that panel per task rather than sharing it.
