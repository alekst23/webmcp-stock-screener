# EPIC-0016: AWS Re-platform

**Status**: 10/13 tickets Done and merged to `main` (2026-09-02). The three
remaining tickets are production operations rather than code: T-0016-8's
Terraform apply, T-0016-10's cutover, and the user-gated T-0016-11
(decommission Render). No further implementation work is outstanding.
**Depends on**: EPIC-0013 (market data storage) — its vectorized panel I/O,
partitioned Parquet, and `measure_universe_scale.py` are the code this epic
deploys and the harness T-0016-9 measures with. **Satisfied**: EPIC-0013 is
merged to `main`, so `backend/infra/panel_io.py` no longer round-trips every
row through `PriceBar` and the measurement harness is present.
**Blocks**: T-0001-9 AC1 (real backfill) and AC5 (live spot-check);
EPIC-0013's T-0013-6, which needs a deployed instance to measure on
**Issue**: #16
**Design**: `docs/design/aws-replatform/` (spec.md, technical.md)

## Description

The backend runs on Render's **free** web plan, which caps the process at
512 MB. Every memory decision in EPIC-0013 and EPIC-0015 was made against
that number, and the number is a free-tier artifact rather than a
requirement: a realistic 3-step/4-study pattern peaks at **723 MB absolute
RSS** against a panel that is only **65.7 MB resident**. The user has
existing, already-paid AWS infrastructure. Moving the backend to a
long-running container with 2–4 GB removes the ceiling outright instead of
engineering around it.

This is a re-platform, not a rewrite. `backend/infra/object_store.py` is
already a boto3 S3 client — it reaches R2 only through a custom
`endpoint_url` — so storage is close to a configuration change. The engine
keeps its stateful-resident design, its public surface, and `PriceBar`
unchanged. What is genuinely new is a container image (the repo has no
Dockerfile on any branch), Terraform, a real health endpoint, and a
scheduled job to replace the Render cron.

Done looks like: the FastAPI service and the nightly delta both running on
AWS from the same image, serving the live Cloudflare frontend, with the
container's absolute peak RSS measured against a stated ceiling — and Render
turned off only after that is true.

## User Story

As the person shipping this workbench,
I want the backend running on a container with real memory instead of a
512 MB free tier,
so that the universe size is a product decision about base-rate quality
rather than a hosting artifact.

## What this does not fix

Peak memory still grows with **expression complexity**, not just row count —
the same panel measures 211 MB of search growth on a simple pattern and
348 MB on a complex one (+65%). This epic converts a hard blocker into a
deferred efficiency problem. EPIC-0015 stays parked with a new trigger:
when measured peak on the deployed container approaches its ceiling.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-0016-1 | Container image for the backend | — | Open |
| 2 | T-0016-2 | Health endpoint independent of the spike stack | — | Open |
| 3 | T-0016-3 | Provider-neutral object store on the AWS credential chain | — | Open |
| 4 | T-0016-4 | Terraform foundation — state, bucket, registry, IAM, minimal network | — | Open |
| 5 | T-0016-5 | Runtime secrets in AWS, out of the gitignored `.env` | T-0016-4 | Open |
| 6 | T-0016-6 | Terraform service module — App Runner service at 2 GB | T-0016-1, T-0016-2, T-0016-3, T-0016-4 | Open |
| 7 | T-0016-7 | Backfill panel to S3 (retargeted from R2->S3 migration -- R2 held nothing) | T-0016-3, T-0016-4 | Done |
| 8 | T-0016-8 | Nightly delta as an EventBridge-scheduled Fargate task | T-0016-1, T-0016-3, T-0016-5, T-0016-7 | Open |
| 9 | T-0016-9 | Measure absolute RSS on the deployed container | T-0016-6, T-0016-7 | Open |
| 10 | T-0016-10 | Cutover — frontend origin, CORS, runbook, rollback | T-0016-6, T-0016-8, T-0016-9 | Open |
| 11 | T-0016-11 | Decommission Render (user-gated) | T-0016-10 | Open |
| 12 | T-0016-12 | No synthetic data in production | T-0016-3 | Open |
| 13 | T-0016-13 | Universe enforcement -- floor the ingest/nightly pipeline and rebuild the production panel | T-0016-7, T-0016-8, T-0016-9, T-0016-12 | Done |

## Dependency Graph

```
T-0016-1 (image) ──────┬──────────────────────┐
T-0016-2 (health) ─────┤                      │
T-0016-3 (store cfg) ──┼──> T-0016-6 (service)├──> T-0016-9 (RSS) ──┐
T-0016-4 (foundation) ─┤                      │                     │
        │              │                      │                     │
        ├──> T-0016-5 (secrets) ──┐           │                     │
        │                         │           │                     │
        └──> T-0016-7 (migrate) ──┴──> T-0016-8 (nightly) ──────────┤
                       │                                            │
                       └────────────────────────────────────────────┤
                                                                    v
                                                        T-0016-10 (cutover)
                                                                    │
                                                                    v
                                                     T-0016-11 (decommission)
```

T-0016-12 is not in the graph above: it was opened after Wave 1
consolidation surfaced two defects in T-0016-3's own delivery (`render.yaml`
left on the old `R2_*` variable names, and no opt-in way for a production
deploy to refuse the mock-panel fallback). It depends only on T-0016-3 and
does not gate or get gated by anything else in this epic; it can run
alongside Wave 2 or later.

## Wave Plan

- **Wave 1** (parallel): T-0016-1, T-0016-2, T-0016-3, T-0016-4 — no
  dependencies. Three touch code, one touches Terraform, and they do not
  overlap in files. T-0016-4 is unaffected by the App Runner decision: it
  provisions only what both platforms need (remote state, bucket, registry,
  IAM) plus the public-subnet network the nightly Fargate task requires.
- **Wave 2** (parallel): T-0016-5, T-0016-6, T-0016-7
- **Wave 3** (parallel): T-0016-8, T-0016-9
- **Wave 4**: T-0016-10
- **Wave 5**: T-0016-11 — **user-gated**, must not run unattended

## Acceptance Criteria

1. The FastAPI service runs on AWS as a long-running container, serving the
   real panel from S3, reachable over HTTPS from the deployed Cloudflare
   frontend origin.
2. The nightly delta runs on a schedule on AWS, from the same image and the
   same code path as the Render cron it replaces, and its append remains
   idempotent by `(ticker, date)`.
3. All infrastructure is expressed in module-based Terraform, `snake_case`,
   `terraform fmt`-clean, and applies from a clean state.
4. No credential — EODHD key or storage credential — is read from a
   committed file, a container image layer, or a plaintext task-definition
   environment variable.
5. The load balancer's health probe targets an endpoint that does not depend
   on the spike stack, so retiring the spike stack cannot break the deploy.
6. Absolute peak RSS of the deployed container is measured on a realistic
   multi-step, multi-study pattern against the real panel, recorded, and
   shown to fit the configured memory ceiling with stated headroom.
7. Render is decommissioned only after 1–6 hold, and only with explicit user
   approval, with a documented rollback path that was valid at the moment of
   cutover.

## Design References

- `docs/reference/deployment.md` — the Render deployment record; T-0016-10's
  runbook mirrors its structure (Live URLs / verification table / deviations
  / references)
- `docs/reference/data-provider.md` — EODHD plan, quota, and why the panel
  lives in object storage rather than on a disk
- `docs/plan/project.md` — the blocker table carries the measured 723 MB
  breakdown, stage by stage, and the decision entries this epic implements
- `render.yaml` — the two services being replaced, and the full environment
  contract each needs an AWS equivalent for
- `docs/plan/EPIC-0013/_epic.md`, `T-0013-6` — the memory work this epic
  deploys, and the measurement method T-0016-9 reuses

## Resolved Decisions

Settled by the user on 2026-09-01. Where a decision went against the
recommendation recorded when this epic was written, the original reasoning
is kept alongside it — a decision is easier to revisit when the argument it
overrode is still legible.

| # | Question | Decision | Recommended was |
|---|----------|----------|-----------------|
| 1 | Region and account | **`us-east-1`, account `490284589142`, profile `alekst23`** | Same. Confirmed empirically: a `postgres` RDS instance `database-1` already runs in `us-east-1` on that account, and the profile's IAM principal is already `terraform-deploy-user`. |
| 2 | ECS/Fargate vs App Runner for the API | **App Runner** | Fargate. Overridden — see below. |
| 3 | Memory ceiling | **2 GB** | 4 GB. Overridden — see below. |
| 4 | Nightly delta mechanism | **EventBridge Scheduler → standalone ECS Fargate task** | Scheduled container task. Held, but the platform changed as a consequence of #2 — see below. |
| 5 | Static keys or task role for S3 | **Default credential chain, instance role** | Same. |
| 6 | Health probe asserts panel readiness | **No — liveness only** | Same. |
| 7 | How far agents go against the live account | **Full `terraform apply`, image push, object migration, and live RSS measurement** | Not previously asked. T-0016-11 (decommission Render) remains user-gated regardless. |

### What decision 2 changes

App Runner was chosen for the API. The argument recorded against it in
T-0016-6 was not that it cannot serve this workload — it can — but that it
serves **only** HTTP, so the nightly batch job needs a second platform and
App Runner's one advantage, less configuration, is spent paying for it.

That cost is now real and accepted. In exchange:

- **No load balancer and no NAT gateway.** App Runner bundles HTTPS and a
  stable `*.awsapprunner.com` hostname. Against the Fargate plan this
  removes roughly $50/month of fixed infrastructure that exists only to
  front one container — the single largest line item in the epic.
- **Far less Terraform.** One `aws_apprunner_service` replaces a load
  balancer, target group, listener, security groups, and an ECS
  service/task-definition pair for the API.
- **Mixed content is solved by default.** The frontend is served over HTTPS
  from `*.workers.dev`; a plaintext backend origin would be blocked. App
  Runner is HTTPS-only, so T-0016-10 has no certificate work.

The costs, stated plainly so T-0016-9 and T-0016-10 measure against them:

- **Memory is an instance-configuration choice, not a task-level number
  with per-task utilization metrics.** T-0016-9 must therefore measure peak
  RSS **from inside the container** rather than reading it off a platform
  metric. This is the correction the project's blocker table already
  records — absolute process RSS, no baseline subtraction — so the method
  is the one already chosen, not a new one.
- **Two platforms.** App Runner for the API, ECS Fargate for the nightly
  job. Both run the same image from the same registry, which is what keeps
  their dependency closures from drifting.
- **Reaching RDS later needs a VPC connector.** Nothing in this epic
  connects to the database, so this is a deferred cost, not a present one.

### What decision 3 changes

2 GB was chosen over the recommended 4 GB. The measurement this must be
read against: **723 MB absolute peak RSS** on a 2,000-ticker × 5-year panel
with a realistic 3-step/4-study pattern, and that figure grows **+65%**
going from a simple pattern to a complex one on the *same* panel — it moves
with expression complexity, not just row count.

2 GB is therefore ~2.8× today's measured peak, and the thing it is
protecting against is user input rather than dataset growth. It is a real
removal of the 512 MB ceiling — a 4× increase, and the blocker this epic
exists to clear is gone at 2 GB. What it does not buy is the untrimmed
2,000 × 10-year universe with confidence.

**Consequence to hold T-0016-9 to:** its AC6 ("fits the configured ceiling
with stated headroom") is now a genuine test rather than a formality. If the
measured peak on a complex pattern against the real panel exceeds ~1.4 GB,
the honest outcome is to report the number and raise the instance size —
which App Runner allows without re-architecture — not to quietly pass. The
memory value stays a Terraform input (T-0016-6 AC1) precisely so that this
is a one-line change.

### What decision 4 changes

The recommendation — one image, one code path, no hard execution ceiling on
the `--catch-up` recovery run — is unchanged and still correct. Lambda's
15-minute limit still binds on exactly the run that must not fail.

What changed is where the container task runs. It can no longer share a
platform with the API, so the nightly job gets an **EventBridge Scheduler
rule invoking a standalone ECS Fargate task** — a task definition and a
cluster with no long-running service, no load balancer, and no NAT gateway
(the task runs in a public subnet with an assigned public IP, so its S3 and
EODHD egress needs no paid gateway). Idle cost is therefore approximately
zero: ECS clusters and task definitions are free, and the task bills only
for the minutes it runs.

## Out of Scope

Moving the frontend off Cloudflare Workers — it works, and moving it buys
nothing; only its API origin and the backend's CORS allowlist change. The
DuckDB/Postgres query-engine port (EPIC-0015 / #15) — this migration makes it
optional rather than necessary. Trimming the universe — the liquidity floor
returns to being a product decision about base-rate quality. Using the
available RDS/Aurora Postgres: it is noted as available and already paid for,
and workspace persistence already sits behind a repository port (`T-1006-4`)
so a Postgres adapter is a later drop-in, but nothing here requires it. Any
change to the engine's public surface or to `PriceBar`.
