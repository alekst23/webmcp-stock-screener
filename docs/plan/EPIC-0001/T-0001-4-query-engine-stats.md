# T-0001-4: Query engine stats

**Epic**: EPIC-0001 (WebMCP Pattern Research Workbench)
**Status**: Done
**Depends on**: T-0001-3
**Blocks**: T-0001-5, T-0001-8
**Issue**: #1

## Description

Once a set of historical pattern instances exists, a researcher needs to
inspect, measure, and split it — sampling concrete examples, measuring
outcomes against a baseline, and separating winners from losers — to test
whether the pattern means anything or is noise.

## User Story

As a user (or their AI agent),
I want to measure and split a set of historical pattern instances,
so that I can tell whether the pattern has a real edge and understand
where it fails.

## Acceptance Criteria

1. A representative sample of instances can be pulled from a result set
   using different selection strategies (e.g., most recent, random,
   best-performing, worst-performing over a given horizon).
2. A metric (default: forward return over a specified number of trading
   days) can be measured across every instance in a result set, returning
   summary statistics including at least count, a central-tendency figure,
   and a hit-rate style measure.
3. The measured statistic for a result set can be compared against the
   same statistic computed across the broader dataset (a base rate), so a
   user can tell whether the pattern beats chance.
4. A result set can be split into labeled sub-sets, either by forward
   return outcome (winners vs. losers) or by an arbitrary condition
   evaluated at each instance's anchor date.
5. A window of price data around each instance's anchor date, across a
   sample of instances, can be retrieved in a form suitable for rendering
   aligned, comparable charts.
6. All of the above are verified correct against the mock dataset's known
   instances and their known outcomes.

## Design References

- `docs/tools.md` — `measure`/`splitInstances`/`sampleInstances`/`showGrid`
  contracts
- `docs/design/pattern-research-workbench/spec.md` — "Instance sampling,"
  "Outcome measurement," "Instance splitting," "Grid visualization"
  scenarios

## Solution Approach

Implements the four scenario groups above from `spec.md`, extending
T-0001-3's `PatternResearchEngine` Protocol rather than defining a
separate one — this is the same engine, incrementally specified. Key
behavior from the design interview: `measure` excludes partial (in-progress)
instances from the statistic and reports how many were excluded via
`MeasureResult.excluded_partial_count`, since a forward return doesn't
exist yet for an unresolved pattern. Base-rate comparison runs the same
metric over the broader universe panel for the same period. Grid data
(`get_instance_windows`) returns price bars only — no chart rendering,
that's T-0001-7.

**Contracts introduced:**
- `MeasureResult`, `BaseRateResult`, `InstanceWindow` →
  `backend/domain/models/measurement.py`
- `PatternResearchEngine` extended with `sample_instances`, `measure`,
  `split_instances`, `get_instance_windows` →
  `backend/domain/contracts/engine.py`

**Config vars introduced:** none.

## Out of Scope

Actually rendering charts (T-0001-7) — this ticket delivers the data, not
the visualization.
