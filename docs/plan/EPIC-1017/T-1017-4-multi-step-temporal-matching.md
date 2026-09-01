# T-1017-4: Multi-step temporal matching in SQL

**Epic**: EPIC-1017 (DuckDB Query Engine)
**Status**: Open
**Depends on**: T-1017-2
**Blocks**: T-1017-5
**Issue**: #15
**Design**: docs/design/duckdb-query-engine/

## Description

The single most uncertain piece of the port. A setup is an ordered sequence
of steps; every step after the first carries `within=(min, max)` meaning it
must fire between `min` and `max` **trading bars** after the step before it
resolved. The window is relative to where the *previous step landed*, not to
the anchor, so the offsets compound and the walk is inherently sequential per
candidate.

`pandas_engine.py` handles this by materializing every step's condition
panel-wide (cause 2, `pandas_engine.py:123`) and then looping in Python over
the anchors. This ticket replaces the whole thing — condition materialization
and walk together — with SQL.

It also has to reproduce a set of behaviors that are easy to lose and hard to
notice: earliest-completion, the sustained variant, decisive failure versus
trailing-edge partial, the completeness fraction, and the fact that only the
*anchor* is checked against the search date range.

## User Story

As a researcher describing a pattern as a sequence of events with timing
between them,
I want the SQL engine to find exactly the occurrences the current engine
finds,
so that the timing semantics I have been relying on do not change underneath
me.

## Acceptance Criteria

1. For a single-step setup, every bar satisfying the condition and falling in
   the search date range is returned as a complete instance.
2. For a multi-step setup, a step resolves at the **earliest** bar within its
   window that satisfies it. A window containing several satisfying bars
   yields one instance, dated from the earliest, not several.
3. A step's window is measured in trading bars from where the previous step
   resolved, not from the anchor and not in calendar days. Demonstrated by a
   three-step case whose second step resolves late enough that an
   anchor-relative reading would place the third step's window elsewhere.
4. A step marked `sustained` requires its condition on every bar of its
   window and resolves at the window's last bar, not its first.
5. A candidate whose next step cannot fire — its window falls entirely inside
   loaded history and contains no satisfying bar, or a sustained condition
   breaks inside it — produces no instance at all, complete or partial.
6. A candidate whose next step's window extends past the end of that ticker's
   loaded history produces a **partial** instance, dated at the last step
   that did resolve, with completeness equal to the fraction of steps
   resolved.
7. Partial instances are returned only when fewer than five complete
   instances were found, and the returned counts distinguish the two.
8. Only the anchor bar is tested against the search date range. An instance
   whose later steps resolve after the range's end is still returned — this
   is the current engine's behavior and this ticket preserves it rather than
   correcting it.
9. Windows never cross a ticker boundary: a candidate near the end of one
   ticker's history never resolves against another ticker's bars.
10. Results are identical to the pandas engine's for a corpus covering all of
    the above, including instance ordering.
11. Peak absolute process RSS while matching a multi-step setup over a panel
    at the target universe shape is measured and recorded, and does not grow
    materially with the number of steps.

## Design References

- `backend/infra/pandas_engine.py` — the reference semantics live in
  `_walk_anchor`, `_resolve_step`, `_resolve_sustained_step`, and
  `_resolve_first_true_step`. The module docstring explains why the walk was
  left sequential; that reasoning is what this ticket is testing.
- `backend/domain/models/pattern.py` — `SetupStep.within` and
  `SetupStep.sustained`.
- `docs/design/pattern-research-workbench/spec.md` — the "Instance search"
  scenarios that fix the five-complete-instance partial threshold and the
  completeness scoring.
- `docs/design/duckdb-query-engine/technical.md`.

## Technical Considerations

**The shape that avoids a join explosion.** A naive temporal self-join —
one join per step, matched on a bar-offset range — produces every satisfying
combination and then discards all but the earliest, which is the opposite of
what the memory budget allows. The tractable formulation computes, for every
bar and every step, *where that step would next resolve*, as a window
aggregate over the bars following it:

- **Non-sustained step `i`**: the minimum bar ordinal at which condition `i`
  holds, over the frame `ROWS BETWEEN min FOLLOWING AND max FOLLOWING`
  partitioned by ticker and ordered by date. Null means "did not fire in the
  window".
- **Sustained step `i`**: a boolean "held throughout" over the same frame,
  resolving at `previous + max`.

Both are one pass over the panel per step. The walk then becomes `k-1`
equality lookups from a candidate's current bar ordinal to the precomputed
next-resolution ordinal — hash joins over the anchor set, not over the panel.

**Distinguishing failure from partial** needs each ticker's last bar ordinal
alongside the above, because a window aggregate silently truncates at the
partition's end: a null result means "did not fire" *or* "window ran off the
end", and only comparing `previous + max` against the ticker's last ordinal
separates them. Getting this wrong turns every trailing-edge candidate into a
silent failure, which is invisible until the partial counts are compared.

**A bar ordinal per ticker is a prerequisite** for all of the above and must
be assigned over the ticker's full loaded history, not over a date-filtered
subset — otherwise a search with a `from_date` shifts every offset.

**`within` bounds are not validated anywhere today.** `SetupStep.within` is
a plain tuple; nothing rejects a negative `min` or a `max` below `min`.
Pandas' slicing tolerates both by producing an empty window; a SQL window
frame will not. See the epic's open questions.

## Out of Scope

Changing any matching semantics, including the anchor-only date-range check
(AC8) — this ticket reproduces behavior, it does not improve it. Instance
statistics and sampling (T-1017-6).
