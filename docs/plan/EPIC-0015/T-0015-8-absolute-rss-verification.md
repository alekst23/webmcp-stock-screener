# T-0015-8: Absolute-RSS memory verification against expression complexity

**Epic**: EPIC-0015 (DuckDB Query Engine)
**Status**: Open
**Depends on**: T-0015-6
**Blocks**: T-0015-9
**Issue**: #15
**Design**: docs/design/duckdb-query-engine/

## Description

The whole point of this epic is one claim: a search's peak memory should stop
tracking how complex the pattern is. This ticket proves it, or proves it did
not happen.

Two things must be right about the measurement or it proves nothing.

**It must be absolute.** EPIC-1016's `scripts/measure_universe_scale.py`
subtracts a baseline captured after the panel is built, so its figures are
*growth*, not footprint. Render kills on the process's whole resident set —
interpreter, imported libraries, panel, and transients together. The
baseline-subtracted numbers understate what the platform sees by roughly the
90-100 MB of interpreter and library residency measured this session. This
ticket reports the number Render acts on.

**It must vary expression complexity, not just rows.** The finding that
motivates the epic is that the same 2.52M-row panel searched with a simple
2-step / 0-study pattern grew 211 MB, and with a 3-step / 4-composed-study
pattern grew 348 MB — +65% for identical data. A measurement that only scales
rows would have missed the entire problem and would miss a regression of the
same kind.

## User Story

As the person deciding whether this engine can be deployed,
I want the peak memory the platform actually sees, across patterns of
increasing complexity,
so that "it fits" is a measurement of the right quantity rather than a
projection from the wrong one.

## Acceptance Criteria

1. Peak resident set size is reported for the whole process, with no baseline
   subtracted, at each stage of the lifecycle: bare interpreter, after
   library imports, after application imports, after engine construction,
   before search, and at peak during search. The pre-DuckDB figures measured
   this session are reproduced in the same table for comparison.
2. The same panel is searched with a ladder of at least three patterns of
   increasing expression complexity — varying step count and the number and
   nesting depth of composed studies — and each pattern's peak is reported
   separately.
3. Peak during search grows by no more than a stated small fraction across
   that ladder. The threshold is stated before the measurement is taken, and
   a result that exceeds it is reported as a failure of the epic's premise
   rather than accommodated.
4. The measurement is repeated at two panel sizes, and the relationship
   between panel size and peak is stated — whether peak tracks panel size,
   tracks the configured engine memory limit, or tracks neither.
5. The engine's configured memory limit and its spill location are stated,
   and a search that exceeds the limit is shown to spill and complete rather
   than fail or be killed. If the target instance has no usable spill
   location, that is recorded as a deployment blocker.
6. Peak is reported against a stated 512 MB budget with explicit headroom,
   and the headroom figure that would trigger the next upgrade rung is
   recorded alongside it.
7. The measurement runs from a committed script that a later change can be
   re-run against, and its output is recorded durably enough to serve as a
   regression baseline.
8. Where the new figures contradict a figure recorded in EPIC-1016's
   T-1016-6, the contradiction is stated explicitly and the cause identified
   — baseline subtraction, panel shape, or pattern complexity.

## Design References

- `docs/plan/EPIC-1016/T-1016-6-verify-full-universe-scale.md` (on
  `epic/EPIC-1016-market-data-storage`) — the existing measurements, their
  baseline-subtracted method, and the ~121 bytes/row marginal search cost
  this ticket's figures should be read against.
- `backend/scripts/measure_universe_scale.py` and
  `backend/scripts/measure_panel_memory.py` (same branch) — the existing
  harness. Reuse the process-isolation approach; do not reuse the baseline
  subtraction.
- `docs/design/duckdb-query-engine/technical.md`.

## Technical Considerations

- Building a large synthetic panel inside the measuring process raises that
  process's peak and contaminates every later reading. The existing scripts
  solve this by splitting the work across two runs; keep that.
- A query engine that spills to disk trades memory for I/O. Report latency
  beside memory so a passing memory figure that costs ten seconds a query is
  visible rather than celebrated.
- The 512 MB budget assumption is inherited from EPIC-1016 and from
  `render.yaml`'s instance tier. If the deployed tier has changed, state the
  real budget rather than measuring against a stale one.

## Out of Scope

Correctness (T-0015-7). The deployed-instance measurements and the real paid
backfill, which remain T-1016-6's outstanding acceptance criteria — this
ticket measures locally on a synthetic panel of the target shape, which is
what the memory question actually depends on.
