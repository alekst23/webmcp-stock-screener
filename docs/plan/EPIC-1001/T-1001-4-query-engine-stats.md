# T-1001-4: Query engine stats

**Epic**: EPIC-1001 (WebMCP Pattern Research Workbench)
**Status**: Open
**Depends on**: T-1001-3
**Blocks**: T-1001-5, T-1001-8
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

## Out of Scope

Actually rendering charts (T-1001-7) — this ticket delivers the data, not
the visualization.
