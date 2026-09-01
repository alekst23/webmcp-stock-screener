# EPIC-0016: AWS Re-platform

**Depends on**: EPIC-0013 (market data storage) — its vectorized panel I/O,
partitioned Parquet, and `measure_universe_scale.py` are the code this epic
deploys and the harness T-0016-9 measures with. Unmerged on
`epic/EPIC-0013-market-data-storage`; `main`'s `backend/infra/panel_io.py`
still round-trips every row through `PriceBar`, and `measure_universe_scale.py`
does not exist there at all.
**Blocks**: T-0001-9 AC1 (real backfill) and AC5 (live spot-check);
EPIC-0013's T-0013-6, which needs a deployed instance to measure on
**Issue**: #16
**Design**: (not started — run `/at-epic-design EPIC-0016`; feature slug
`aws-replatform`)

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
| 4 | T-0016-4 | Terraform foundation — network, bucket, registry, IAM | — | Open |
| 5 | T-0016-5 | Runtime secrets in AWS, out of the gitignored `.env` | T-0016-4 | Open |
| 6 | T-0016-6 | Terraform service module — container service and task definition | T-0016-1, T-0016-2, T-0016-3, T-0016-4 | Open |
| 7 | T-0016-7 | Migrate panel objects from R2 to S3 | T-0016-3, T-0016-4 | Open |
| 8 | T-0016-8 | Nightly delta as a scheduled AWS job | T-0016-1, T-0016-3, T-0016-5, T-0016-7 | Open |
| 9 | T-0016-9 | Measure absolute RSS on the deployed container | T-0016-6, T-0016-7 | Open |
| 10 | T-0016-10 | Cutover — frontend origin, CORS, runbook, rollback | T-0016-6, T-0016-8, T-0016-9 | Open |
| 11 | T-0016-11 | Decommission Render (user-gated) | T-0016-10 | Open |

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

## Wave Plan

- **Wave 1** (parallel): T-0016-1, T-0016-2, T-0016-3, T-0016-4 — no
  dependencies. Three touch code, one touches Terraform, and they do not
  overlap in files.
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

## Open Questions

Recorded with a recommended default rather than guessed. Each needs a user
decision before the ticket that depends on it starts.

1. **Region.** Unknown — the issue asks it and nothing in the repo names an
   AWS region. *Recommended default:* match the region of the existing
   RDS/Aurora and the rest of the paid infrastructure, even though this epic
   does not use the database. A later server-side workspace store or a
   Postgres re-evaluation (EPIC-0015) would otherwise cross regions and pay
   egress for the privilege.
2. **ECS/Fargate vs App Runner.** *Recommended: ECS Fargate.* Reasoning in
   T-0016-6. The short version: App Runner's advantage is less configuration
   for a single HTTP service, but this system is not a single HTTP service —
   it is an HTTP service plus a nightly batch job. App Runner cannot run the
   batch job, so choosing it means operating two platforms and the
   simplicity is spent. Fargate also exposes memory as an explicit task-level
   number with per-task utilization metrics, and this epic exists to move
   that number. The honest cost is more Terraform and a load balancer the
   service must pay for monthly; App Runner bundles HTTPS and a hostname.
3. **Memory ceiling: 2 GB or 4 GB.** *Recommended: 4 GB.* 723 MB is a
   measured peak that is already known to move with user input (+65% simple
   to complex pattern), so 2 GB is ~2.8x on a figure that grows for reasons
   the epic does not fix. 4 GB is also what makes the untrimmed 2,000-ticker
   x 10-year universe possible, which is the whole point. This is one task's
   memory, not a fleet's.
4. **Nightly delta: Lambda or scheduled container task.** *Recommended:
   scheduled container task.* The issue is right that the ordinary nightly
   run is Lambda-shaped. The recovery run is not: `--catch-up` resumes from
   the panel's as-of date and applies every missing session in one rewrite,
   which is the longest run the job has and the one that must not fail.
   Rather than two mechanisms for one job, run both paths the same way. See
   T-0016-8.
5. **Static keys or the task role for S3.** *Recommended: the default
   credential chain, with a task role.* `config_from_env` requires an access
   key and secret and returns `None` when either is missing — and `None`
   means silently serving the mock panel. A role-based deploy would look
   healthy while serving synthetic data. See T-0016-3.
6. **Does the health probe assert panel readiness?** *Recommended: no.*
   T-0013-5 chose to disclose degradation rather than fail on it, and
   `load_panel` deliberately falls back to the mock panel. Failing the load
   balancer probe on that fallback makes a degraded-but-working deploy
   unroutable. Liveness on the health endpoint; panel provenance stays on
   `GET /api/research/panel`. See T-0016-2.

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
