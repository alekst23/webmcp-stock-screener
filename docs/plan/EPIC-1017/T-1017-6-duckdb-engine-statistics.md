# T-1017-6: DuckDB engine — sampling, measurement, splits, and windows

**Epic**: EPIC-1017 (DuckDB Query Engine)
**Status**: Open
**Depends on**: T-1017-5
**Blocks**: T-1017-7, T-1017-8
**Issue**: #15
**Design**: docs/design/duckdb-query-engine/

## Description

Complete the Protocol: `sample_instances`, `measure`, `split_instances`, and
`get_instance_windows`. These operate on an instance set that already exists,
so they read far less of the panel than a search does — but two of them have
teeth. `measure` compares against a base rate drawn from across the whole
panel, and `get_instance_windows` fetches a bar window around each sampled
instance. Both are scattered reads, which is precisely the access pattern
T-1016-3 recorded as the case where ticker pruning does *not* help.

`split_instances` in condition mode re-evaluates an arbitrary expression at
each instance's bar, so it inherits everything from T-1017-2 and must not
re-run a whole-panel evaluation to answer a question about a few hundred
rows.

## User Story

As a researcher measuring what a pattern actually did,
I want the statistics to come back with the same numbers the current engine
produces,
so that swapping the engine does not change my conclusions.

## Acceptance Criteria

1. All four methods match the existing engine's signatures and return types,
   and a type check confirms the adapter now satisfies the full
   `PatternResearchEngine` Protocol.
2. `sample_instances` returns the same instances as the existing engine for
   the `recent` strategy, and for `best` and `worst` at a given horizon.
   Instances whose forward return is not computable are dropped rather than
   ranked, as today.
3. `sample_instances` with the `random` strategy returns the requested count
   drawn from the instance set, and returns the whole set when asked for
   more than it holds.
4. `sample_instances` raises the same error when `best` or `worst` is
   requested without a horizon.
5. `measure` returns statistics matching the existing engine's for the same
   instance set and horizon, excludes partial instances from the statistic,
   and reports how many it excluded.
6. `measure`'s base-rate comparison draws a sample equivalent in
   distribution to the existing engine's, and the comparison is stable
   enough that repeating it on the same panel moves the reported figures by
   less than a stated margin.
7. `split_instances` in outcome mode and in condition mode partitions the
   same instances the same way as the existing engine, and raises the same
   errors when the mode's required argument is missing.
8. `get_instance_windows` returns bar windows matching the existing
   engine's, including truncation at a ticker's history boundaries.
9. Peak absolute process RSS across all four methods over a panel at the
   target universe shape is measured and recorded, and no single method
   dominates the search peak T-1017-8 measures.
10. A scattered read across many tickers — which is what these methods
    generate — is measured for bytes read and latency, and the figure is
    recorded next to T-1016-3's pruning table so the two are comparable.

## Design References

- `backend/domain/contracts/engine.py` — the four remaining methods and
  their documented preconditions.
- `backend/infra/pandas_engine.py` — reference behaviors for sampling
  strategies, forward returns, base-rate sampling, splits, and windows.
- `backend/domain/models/measurement.py` — `MeasureResult`,
  `BaseRateResult`, `InstanceWindow`.
- `docs/plan/EPIC-1016/T-1016-3-ticker-partitioned-parquet.md` (on
  `epic/EPIC-1016-market-data-storage`) — its "where pruning does not help"
  section is the basis for AC10: a thin sample scattered across the
  alphabet reads nearly the whole file.
- `docs/design/duckdb-query-engine/technical.md`.

## Technical Considerations

- The base-rate sample is a fixed number of random anchor draws across the
  whole panel in the current implementation. Reproducing "equivalent in
  distribution" (AC6) is a weaker claim than reproducing identical values,
  deliberately — random sampling cannot be made bit-identical across two
  engines without fixing a shared seed and a shared draw order, which would
  couple them.
- Forward returns need a bar `horizon_days` ahead *in trading bars for that
  ticker*, which is the same per-ticker ordinal arithmetic T-1017-4
  establishes. Reuse it rather than inventing a second convention.
- These methods are called repeatedly in an interactive session against the
  same instance set. Whatever caching T-1017-1 settled on is what makes that
  bearable; if it turns out not to be, that is a finding for T-1017-9's
  wiring decision.

## Out of Scope

Any change to the statistics themselves. Differential verification
(T-1017-7) — this ticket asserts equality on cases it chooses; T-1017-7
asserts it on a corpus.
