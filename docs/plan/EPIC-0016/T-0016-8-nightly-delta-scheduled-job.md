# T-0016-8: Nightly delta as a scheduled AWS job

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open
**Depends on**: T-0016-1, T-0016-3, T-0016-5, T-0016-7
**Blocks**: T-0016-10
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

`render.yaml`'s second service is a cron — `webmcp-panel-nightly-delta`, on
the **paid** `starter` plan, `schedule: "30 6 * * *"`, running
`scripts/nightly_delta.py`. It downloads the stored panel, appends one
bulk-by-exchange trading day (~100 EODHD quota units against a 100,000/day
cap), and re-uploads. Without it the panel goes stale and the workbench
starts answering questions about a market that has moved on.

The issue asks whether this becomes a scheduled container task or a Lambda,
and observes correctly that the API's argument against Lambda does not apply
here: this job is short, batch, and holds no resident panel. That is true of
the **ordinary** run.

**Settled: an EventBridge Scheduler rule invoking a standalone ECS Fargate
task, on the same image.** The user's choice of App Runner for the API
(`_epic.md`, Resolved Decisions) means this job cannot share the API's
platform — App Runner serves HTTP and nothing else — so the "one platform"
argument below no longer applies. Everything else in it does, and it is what
still rules out Lambda. The
deciding case is the recovery run. `nightly_delta.py --catch-up` resumes from
the panel's own as-of date and applies every missing session in one rewrite —
it is the longest run the job has, it is the one invoked after a stretch of
failed nights, and it is therefore the one that must not hit a hard execution
ceiling. Lambda's 15-minute limit binds exactly there. Splitting the ordinary
run onto Lambda and the recovery run onto something else means two
mechanisms, two IAM configurations, and two dependency closures for one job.
One image, one role, one code path is worth more than the marginal cost
difference on a job that runs once a day.

The shape this takes: a task definition and an ECS cluster with **no
long-running service**, no load balancer, and no NAT gateway — the task runs
in T-0016-4's public subnet with an assigned public IP. An empty ECS cluster
and an unused task definition are free; the job bills only for the minutes
it runs. The two-platform cost of the App Runner decision is therefore paid
in Terraform and in operational surface, not in a monthly charge.

Done looks like: the panel advancing by one session each night on AWS,
idempotently, with a failed night visible rather than silent.

## User Story

As the workbench,
I want the stored panel to gain the latest trading day automatically,
so that pattern research runs against current data with no manual step.

## Acceptance Criteria

1. The nightly delta runs automatically on a schedule equivalent to the
   Render cron's 06:30 UTC daily, and the schedule is a configuration input.
2. It runs the same script, from the same image as the API service, reaching
   the same argument parsing and the same failure messages.
3. After a run, the stored panel's as-of date advances to the expected
   trading day and the API reports the new date without redeployment.
4. Re-running for a day already present replaces those rows rather than
   duplicating them, so a retry is safe.
5. On a market holiday, when the provider returns no rows, the run completes
   and leaves the panel unchanged.
6. The catch-up mode can be invoked on demand against the deployed
   configuration and applies every missing session in one pass, with no
   execution-time ceiling that a realistic backlog would hit.
7. A failed run is visible without anyone inspecting logs by hand, and does
   not leave the stored panel partially written.
8. The job reaches the EODHD key and the bucket through the same secret and
   identity mechanisms as the API service, with no separately managed
   credential.
9. Exactly one scheduled writer is active at a time across Render and AWS,
   so the two deployments cannot append to diverging copies of the panel.

## Solution Approach

A new `terraform/modules/nightly_job` module, composed alongside (not
inside) `modules/apprunner_service`, adds:

- **ECS cluster** `webmcp-<env>-nightly`, Fargate capacity provider only —
  no service, no load balancer. An empty cluster and an unused task
  definition are free; idle cost is $0.
- **Task definition** `webmcp-<env>-nightly-delta`, `awsvpc` network mode,
  running the *same* ECR image the App Runner service runs
  (`var.image_identifier`, wired from the root module's existing
  `module.registry` / `var.apprunner_image_tag`, so one apply can never
  point the two platforms at different digests). Container command is the
  ordinary run, `["python", "scripts/nightly_delta.py"]` — no `uv run`
  needed, since the runtime image's `PATH` already activates `/opt/venv`
  (`backend/Dockerfile`). `--catch-up` is never baked into the task
  definition; it is supplied per-invocation via an ECS `RunTask`
  container override (AC6), so the recovery path and the ordinary path
  share one task definition and one role, not two.
- **Roles reused unchanged, zero edits to `modules/iam`:** `pull_log_role_arn`
  becomes the ECS *execution* role (image pull + log write — its trust
  policy already lists `ecs-tasks.amazonaws.com` and its log-group ARN
  pattern is already `/ecs/webmcp-*`), `app_role_arn` becomes the ECS *task*
  role (same S3 `GetObject`/`PutObject`/`ListBucket` and SSM
  `GetParameter`/`GetParameters`/KMS `Decrypt`/`DescribeKey` grants the API
  already has). This is AC8 and AC2 together: same image, same identity,
  same argument parsing, same failure messages, no separately managed
  credential — and it means T-0016-6's two hard-won IAM lessons (HeadBucket
  needs `ListBucket`; secret resolution needs the plural `GetParameters` +
  `kms:DescribeKey`) are inherited for free rather than rediscovered.
- **Networking:** the task launches into T-0016-4's two existing public
  subnets with `assign_public_ip = ENABLED`, behind a task-scoped security
  group with egress-only `0.0.0.0/0` (S3 and EODHD are both outbound HTTPS)
  and no ingress rule at all. No NAT gateway, matching the epic's decision.
- **Scheduling:** `aws_scheduler_schedule` (EventBridge Scheduler, not a
  legacy CloudWatch Events rule) with `schedule_expression` as a module
  input, default `cron(30 6 * * ? *)` — Render's `30 6 * * *` translated to
  EventBridge's 6-field cron (`?` for day-of-week since day-of-month is a
  literal `*`... concretely: minute=30 hour=6 every day). `flexible_time_window
  { mode = "OFF" }` keeps the same exact-time semantics Render's cron has.
  The target is the ECS cluster ARN with `ecs_parameters` naming the task
  definition, `FARGATE` launch type, and the same subnets/security group.
  A minimal new IAM role trusted only by `scheduler.amazonaws.com`, scoped
  to `ecs:RunTask` on this one task-definition family and `iam:PassRole` on
  exactly the execution/task role ARNs (condition
  `iam:PassedToService = ecs-tasks.amazonaws.com`), lives *inside this new
  module* — not appended to `modules/iam` — so the shared IAM module used by
  the live App Runner service is never touched by this ticket.
- **Logs:** `/ecs/webmcp-<env>-nightly-delta`, matching the ARN pattern the
  execution role's policy already authorizes, explicit retention (default
  30 days, mirroring the App Runner service).
- **Failure visibility (AC7):** `nightly_delta.py` already `sys.exit()`s
  with a non-zero code on `PanelStoreError`/`PriceSourceError`, so a failed
  run shows up as an ECS task with `lastStatus = STOPPED` and a non-zero
  `exitCode` — visible via `aws ecs describe-tasks`, the ECS console's task
  history, or the EventBridge Scheduler invocation history, with no log
  scraping required. The job never partially writes (Technical
  Considerations: download → append → re-upload the whole object), so a
  failed run leaves the previous panel object intact either way. Alerting
  beyond "visible in the platform's own surfaces" is Out of Scope.
- **AC9 — the cutover hazard, decided explicitly:** the Render cron
  (`webmcp-panel-nightly-delta`) keeps running unchanged through this
  ticket; turning it off is T-0016-11's job, gated on the user. To make
  "exactly one scheduled writer is active at a time" true by construction
  rather than by coincidence, the EventBridge Scheduler rule this module
  creates is applied in **`state = "DISABLED"`**. This ticket proves the
  AWS path end-to-end — ordinary run, catch-up, idempotency, holiday no-op
  — entirely through on-demand `aws ecs run-task` invocations (steps
  4–6 below), never by letting the rule fire. The rule is left wired,
  correctly scheduled, and provably working, but inert. T-0016-10/T-0016-11
  flips it to `ENABLED` in the same breath that Render's cron is retired,
  which is the only point at which two enabled schedules would ever be a
  live hazard.

## Design References

- `render.yaml` — the cron service being replaced: plan, schedule, start
  command, and its five environment variables
- `backend/scripts/nightly_delta.py` — the entry point, its `--exchange`,
  `--day`, `--key`, and `--catch-up` arguments, and its documented
  idempotence and holiday behavior
- `backend/application/append_daily_delta.py` — `append_daily_delta`,
  `catch_up_sessions`, `latest_completed_trading_day`
- `backend/scripts/_cli_env.py` — the configuration the job requires and how
  it refuses to run without it
- `docs/reference/data-provider.md` — the bulk-by-exchange endpoint choice
  and the quota arithmetic behind AC1's once-daily schedule

## Technical Considerations

AC7's "not partially written" is a property of the current design worth not
breaking: the job downloads, appends, and re-uploads the whole object, so a
crash mid-run leaves the previous object intact. Bucket versioning
(T-0016-4 AC5) covers the case where a bad run completes successfully with
wrong data — the more likely failure of the two.

AC9 is a cutover hazard, not an infrastructure detail. Between this ticket
landing and T-0016-11, the Render cron and the AWS job both exist. Two
schedulers appending to two buckets produce two panels that diverge by a
session per night, and the rollback path in T-0016-10 assumes R2 is a valid
fallback. Decide explicitly which one writes during the overlap and record it.

The schedule is expressed in UTC and the job asks the provider for the most
recent completed weekday, so a UTC schedule still targets the right session —
keep that property rather than introducing a local timezone.

If the recommendation is overridden in favor of Lambda, AC6 is the criterion
that has to be answered, not waved past: state the worst realistic backlog and
show the catch-up run fits within the execution limit at that backlog.

## Out of Scope

The initial backfill, which is a one-time paid operation, not a scheduled
job. Changing the append semantics, the exchange, or the schedule's time.
Alerting policy beyond AC7's requirement that a failure be visible.
