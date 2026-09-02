# T-0016-9: Measure absolute RSS on the deployed container

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open
**Depends on**: T-0016-6, T-0016-7
**Blocks**: T-0016-10
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

The entire epic rests on one claim: 723 MB fits comfortably in 2–4 GB. That
number was measured on a laptop against a synthetic panel. This ticket
replaces the projection with a measurement on the thing that actually
enforces the limit, and records it as a baseline a regression can fail
against.

It also settles the memory-sizing open question with evidence instead of
argument, and re-arms EPIC-0015's trigger — the DuckDB port is parked, not
cancelled, and its new trigger is "measured peak on the deployed container
approaches its ceiling". Somebody has to produce that measurement for the
trigger to mean anything.

**Measure absolute RSS.** The project's blocker table records exactly this
mistake being made and corrected: earlier figures subtracted a baseline taken
*after* imports, which made a 723 MB process look like 385 MB. The container
runtime counts the whole process — interpreter, libraries, application
imports, the compressed Parquet bytes, the parsed frame, and every evaluation
transient. A baseline-subtracted number is a number the platform never sees,
and reporting success against it would be reporting success against fiction.

Done looks like: a table of absolute figures from the deployed container, a
memory ceiling chosen from them, and a stated headroom that names the point
at which EPIC-0015 stops being optional.

## User Story

As the person who has to trust this deployment,
I want the container's real peak memory measured against its real limit,
so that "it fits" is a measurement rather than a projection, and so that the
next ceiling is predicted before it is hit.

## Acceptance Criteria

1. Peak memory is measured as absolute resident set size of the whole
   process, with no baseline subtracted, on the deployed container rather
   than on a development machine.
2. Measurements are taken against the real migrated panel, not a synthetic or
   mock one, and the panel's shape — ticker count, date range, row count, and
   resident size — is recorded alongside them.
3. Figures are recorded for each distinct stage: process start before any
   panel load, after the panel is loaded and steady, and at peak during a
   whole-universe search.
4. The search used for the peak is a realistic multi-step, multi-study
   pattern, not the simplest expression that will run, and the pattern is
   recorded precisely enough to re-run.
5. Peak is also measured on a deliberately simple pattern against the same
   panel, so the growth attributable to expression complexity is quantified
   rather than assumed.
6. The configured memory ceiling is stated, the measured peak's headroom
   against it is stated as a percentage, and the ceiling is either confirmed
   or changed as a result.
7. The measurement harness reports absolute RSS, and any earlier
   baseline-subtracting behavior in it is corrected so a later run cannot
   repeat the error.
8. Results are recorded somewhere durable enough to serve as a regression
   baseline, including the headroom figure that re-triggers the DuckDB work.

## Solution Approach

**How absolute RSS is obtained.** App Runner exposes request-level metrics
only, not per-task memory, so the number has to come from inside the process.
`resource.getrusage(RUSAGE_SELF).ru_maxrss` is a high-water mark that never
decreases within a process, so reading it at a checkpoint always reports the
true peak up to that point — the same instrument `measure_panel_memory.py`
already uses. The defect this ticket exists to correct is not in that
function; it is in `measure_universe_scale.py`'s `measure()`, which takes a
`baseline = peak_rss_bytes()` *after* the panel bytes are already on disk and
the pandas/pyarrow/boto3 stack is already imported, then reports
`peak_rss_bytes() - baseline` at every later stage. Because `ru_maxrss` is
monotonic, that subtraction produces a delta from an arbitrary already-late
starting point, not the absolute number the container's cgroup enforces —
exactly the mistake the blocker table records against the earlier 688 MB
figure. New script, `backend/scripts/measure_container_memory.py`, reports
every stage as the raw, un-subtracted reading (AC7): interpreter start,
after third-party libraries import, after this project's own modules import,
after the real panel's bytes are fetched from S3, after they are parsed,
before search, and at peak during search. Each number already includes every
prior stage's cost, matching how the blocker table's own breakdown reads.

**Where it runs.** Built and run as the exact deployed image
(`backend/Dockerfile`, `docker build backend`), not a bare `uv run` on this
host — the container runtime, its base image, and its process tree are part
of what the 2 GB ceiling has to hold, and a host-Python run would omit them.
The container is given real, read-only AWS credentials (`aws configure
export-credentials --profile alekst23`) so `infra/object_store.py`'s
existing S3 client fetches the real deployed object
(`s3://webmcp-panel-prod-490284589142/panel.parquet`, verified
`ContentLength` 81,254,506 bytes) exactly as the running App Runner service
does — same code path, same bytes, no synthetic panel, no mock fallback.
`docker run --memory=2g --cpus=1` mirrors the App Runner instance
configuration (2048 MiB / 1024 CPU units) so a genuine breach would surface
as an OOM kill under the same ceiling the service runs under, not just as a
number compared against 2 GB after the fact.

**The two patterns.** AC5 requires quantifying growth from a trivial pattern,
not just asserting the realistic one is bigger, so both run against the
identical panel and identical pipeline up to "before search", differing only
in the setup passed to `find_instances`:

- *simple* — one step, zero studies: `close > sma(close, 50)`. As trivial as
  a valid setup gets.
- *complex* — 3 steps referencing 4 studies, a plausible research pattern
  (volume-spike anchor → uptrend confirmation → breakout), matching the
  epic's "3-step/4-study" reference figure:
  - studies: `rel_volume = volume / sma(volume, 20)`,
    `trend200 = close - sma(close, 200)`,
    `momentum12 = close - ema(close, 12)`, `vol_atr = atr(14)`
  - step 1: `rel_volume > 3` (narrow anchor)
  - step 2, within (1, 10): `trend200 > 0 and momentum12 > 0`
  - step 3, within (1, 15): `close > highest(high, 20) and vol_atr > 0`

Each pattern runs in its own fresh container invocation (`ru_maxrss` cannot
fall back down within one process, so measuring both in one run would let
the first pattern's peak contaminate the second's).

## Design References

- `docs/plan/project.md` — the blocker table's stage-by-stage 723 MB
  breakdown (14 MB interpreter, 90 MB with libraries, 100 MB with app
  imports, 217 MB after the whole-file Parquet read, 364 MB parsed, 385 MB
  before search, 723 MB peak), and the explicit correction about
  baseline subtraction that AC1 and AC7 encode
- `docs/plan/EPIC-0013/T-0013-6-verify-full-universe-scale.md` — the
  synthetic-panel measurements this supersedes, and the ACs it closes on the
  deployed-instance side
- `backend/scripts/measure_universe_scale.py` — the existing harness
  (on `epic/EPIC-0013-market-data-storage`; absent from `main`)
- `backend/infra/expression.py`, `backend/infra/pandas_engine.py` — why peak
  scales with expression complexity, which is what AC5 quantifies
- T-0016-6 — the configured ceiling AC6 confirms or changes

## Technical Considerations

The three costs are separable and the data is the smallest of them: a
whole-file read that holds compressed bytes and parsed frame live at once, a
parse transient, and search transients that are the only ones growing with
expression complexity. AC3's staged reporting exists so a future regression
can be attributed rather than merely detected.

This ticket also closes EPIC-0013's T-0013-6 ACs 2 and 3 on the
deployed-instance side — the parts that were blocked purely on there being an
instance to measure. Cross-reference rather than duplicate.

Measuring on the container means either instrumenting the process itself or
reading the platform's per-task memory metric. Both are acceptable; if the
platform metric is used, confirm once against an in-process reading that the
two agree, because they measure subtly different things and the epic's whole
premise depends on which.

## Out of Scope

Fixing the memory behavior — EPIC-0015 owns that and stays parked. Latency
or throughput benchmarking. Choosing the universe's liquidity floor, which is
a product decision this measurement informs but does not make.
