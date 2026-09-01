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
