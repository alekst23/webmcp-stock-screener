# T-0016-6: Terraform service module — App Runner service at 2 GB

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Done — deployed and verified 2026-09-01 (see Verification Evidence).
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

## Verification Evidence (2026-09-01)

Module: `terraform/modules/apprunner_service`, composed by `terraform/main.tf`
alongside the existing network/panel_bucket/registry/iam/secrets modules.
Deployed image: `490284589142.dkr.ecr.us-east-1.amazonaws.com/webmcp-backend-prod:f411683`,
digest `sha256:af6a3061ed43f41efeff0a826dbc8e2fc92bcc41f938995157d4655fcf0d1823`
(T-0016-1's verified image, built `--platform linux/amd64`, pushed to the
IMMUTABLE-tagged ECR repo T-0016-4 provisioned).

### Two real bugs found and fixed during `terraform apply` (not hypothetical)

1. **AC9 (app identity reads the real bucket)**: `infra/object_store.py`'s
   `ensure_reachable()` calls S3 `HeadBucket`, which IAM authorizes under
   `s3:ListBucket` — not `s3:GetObject`. The app role (T-0016-4) had only
   object-level `GetObject`/`PutObject`, confirmed missing via `aws iam
   simulate-principal-policy` (`implicitDeny`). Fixed in
   `terraform/modules/iam/main.tf`: added a `PanelBucketReachabilityCheck`
   statement granting `s3:ListBucket` on the bucket ARN only (not
   `${bucket_arn}/*`) — the app still never lists objects, this exists
   solely to authorize the HEAD check.
2. **AC6 (secrets by reference)**: the App Runner service failed
   `CREATE_FAILED` twice, image pulled successfully both times but zero
   application-log lines were ever written (the container never launched).
   Isolated by temporarily deploying with an empty
   `runtime_environment_secrets` map, which succeeded — proving secret
   resolution was the blocker, not networking/health-check/CPU-memory.
   Root cause, confirmed via `aws iam simulate-principal-policy`: App
   Runner resolves `runtime_environment_secrets` on the **instance role**
   using the batch `ssm:GetParameters` (plural) API and `kms:DescribeKey`,
   not the singular `ssm:GetParameter`/`kms:Decrypt` pair a manual `aws ssm
   get-parameter` call uses. `terraform/modules/secrets/main.tf`'s
   `app_read_eodhd_api_key` policy only granted the singular actions.
   Fixed by adding `ssm:GetParameters` and `kms:DescribeKey` to that
   policy. Re-applied with the secret restored; the running service
   updated in place (4m15s) and came up healthy with the secret injected.

### Service replacement / hostname stability (answering the coordinator's question)

The service's hostname changed once during this session (`ymh82a3n4m` →
`awiz9fcu3b`), but **not** as a property of ordinary operation. Sequence:
a `CREATE_FAILED` service from bug #2 above sat in Terraform state; my
diagnostic apply (secrets removed) tried to `UpdateService` a service that
was never running, which AWS's App Runner API does not support in place --
the provider deleted and recreated the service, producing a new
`service_id` and therefore a new `*.awsapprunner.com` hostname. This is a
failure-recovery path, not steady state: once the service reached
`RUNNING`, the very next apply (restoring the secret) updated the **same**
service in place (`aws_apprunner_service.this: Modifying...`, 4m15s, "0
added, 3 changed, 0 destroyed") with **no ARN or URL change** -- confirmed
directly, since `apprunner_service_url` was identical before and after
that apply. An ordinary image-tag bump (T-0016-9/T-0016-10's normal
deploy path) only ever touches `image_identifier`, which App Runner
updates via rolling deployment in place. The hostname is stable for T-0016-10
to hardcode, as long as future applies don't hit a `CREATE_FAILED` state.

### AC-by-AC

- **AC1**: `instance_configuration { cpu = "1024", memory = "2048" }`, both
  module inputs (`var.apprunner_cpu`/`var.apprunner_memory`, root defaults),
  not literals in the module.
- **AC2**: `https://awiz9fcu3b.us-east-1.awsapprunner.com/health` →
  `{"status":"ok"}`, `200`. No certificate/DNS record in this repo --
  App Runner's own `*.awsapprunner.com` + managed TLS.
- **AC3/AC4**: health check targets `/health` (T-0016-2, liveness only).
  `interval=20s` (AWS max), `timeout=15s`, `healthy_threshold=1`,
  `unhealthy_threshold=10` -- chosen to tolerate S3-backed panel load
  blocking startup (default 5s/2s/threshold-5 gives ~25s, nowhere near
  enough). Measured real cold start against the **real** panel from
  CloudWatch application logs: `Started server process` at
  `19:50:52.397` ET, `Application startup complete` at `19:50:55.150` ET --
  **2.75s**, comfortably inside the ~200s budget the configured thresholds
  allow. AC4 verified structurally: the health endpoint (`api/routes/health.py`)
  makes no file/object-store/panel call at all, so a mock-panel or no-panel
  instance answers identically -- this is what T-0016-2 already guarantees.
- **AC5**: `CORS_ALLOWED_ORIGINS=https://webmcp-stock-screener.alekst23.workers.dev`,
  `RATE_LIMIT_DEFAULT=60/minute`, `REQUIRE_REAL_PANEL=true`,
  `OBJECT_STORE_BUCKET=webmcp-panel-prod-490284589142`,
  `OBJECT_STORE_REGION=us-east-1`, `EODHD_API_KEY` by SSM reference --
  every render.yaml env var has an AWS equivalent (confirmed live via
  `aws apprunner describe-service`).
- **AC6**: `EODHD_API_KEY` is a `runtime_environment_secrets` entry
  referencing the SSM parameter ARN, never a value; `describe-service`
  shows only the ARN. No secret value in any Terraform file, state diff
  shown above, or this document.
- **AC7**: logs land in `/aws/apprunner/webmcp-prod-api/<id>/application`
  and `.../service`; both imported into Terraform state and
  `retention_in_days=30` applied (`terraform plan` confirms 0 -> 30 took
  effect, no further drift).
- **AC8**: rolling deploy with automatic rollback is App Runner's built-in
  behavior (unchanged by this module). `auto_deployments_enabled = false`,
  deliberately: ECR tags are immutable (T-0016-4), so this deployment tags
  images by git SHA -- a given `image_identifier` is never repushed, and a
  new commit always needs a Terraform apply to change the tag anyway.
  Auto-deploy would never fire in this tagging scheme; leaving it off keeps
  every deploy an explicit, auditable Terraform change.
- **AC9**: live `GET /api/research/panel` (with the frontend's Origin
  header) returned `{"source":"object-store","is_synthetic":false,
  "ticker_count":1999,"row_count":2338597,"as_of":"2026-09-01",
  "is_stale":false}` -- the real, T-0016-7-backfilled panel, read via the
  app role's default credential chain (no static keys anywhere in this
  module).
- **AC10**: `terraform fmt -check -recursive` exits 0. Module composed by
  root `main.tf`; region/environment/image/cpu/memory are all inputs
  (`var.region`, `var.environment`, `var.apprunner_image_tag`,
  `var.apprunner_cpu`, `var.apprunner_memory`).
- **AC11**: `output "apprunner_service_url"` = `awiz9fcu3b.us-east-1.awsapprunner.com`.

### REQUIRE_REAL_PANEL decision

Set to `true`, matching render.yaml's production value. Justification:
`load_panel`'s guard only fires when `store is None` (`OBJECT_STORE_BUCKET`
entirely unset) -- with a bucket configured but empty (the state this
service was in for part of this session, mid-backfill), `ensure_reachable()`
succeeds and `object_exists(panel.parquet)` returns `False`, falling
through to the mock panel exactly as it does today, **unaffected** by this
flag. A wrong bucket or denied permission still aborts startup loudly
either way, via `ensure_reachable()` -- the actual hazard T-0016-12 exists
to close. This was proven in both directions during this session: the
service ran healthy on the mock panel before the real `panel.parquet`
existed, and now serves the real panel now that it does, with no
Terraform or code change in between -- only a rolling deploy picking up
what's in the bucket at container-start time.

### `terraform plan` after apply -- no drift

```
No changes. Your infrastructure matches the configuration.

Terraform has compared your real infrastructure against your configuration
and found no differences, so no changes are needed.
```

### Cost

App Runner 1 vCPU / 2 GB, one fixed instance (`aws_apprunner_auto_scaling_configuration_version`
pinned `min_size=max_size=1`), running continuously: roughly **$55-60/month**
at published per-vCPU-hour / per-GB-hour active-tier rates. Plus negligible
CloudWatch Logs storage (30-day retention) and ECR storage for one ~150 MB
image layer set. No load balancer, NAT gateway, or VPC connector -- none
were created (confirmed: `network` module's public-subnet-only design was
untouched by this ticket, and this module creates no networking resources
at all).
