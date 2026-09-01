# T-1010-4: Paged results projection use case (`get_screener_results`)

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Open
**Depends on**: T-1010-1, T-1010-2
**Blocks**: T-1010-7

## Description

Orchestrate reading a bounded page of an existing run: take a `run_id` and
a page request, read the pinned run through the read-only contract, apply
the results table's configured computed columns, sort, and grouping across
the full result set, then return the requested page with its total,
cursor, and provenance. The behavioral guarantee this ticket must not
break: no read ever executes a screener.

## User Story

As an agent that has just run a screener,
I want to page through its results as many times as I like,
so that I can survey the whole result set without re-running the query or
paying for it again.

## Acceptance Criteria

1. Given a pinned `run_id`, a page of at most the requested size is
   returned, along with the total number of results and a next-page cursor
   (absent on the last page).
2. Rows are projected through the results table's configured columns,
   including computed columns, and are ordered by its configured sort with
   its deterministic tie-break.
3. Computed columns and sort are applied across the run's full result set
   before the page is cut, so paging is stable and the sort is globally
   correct rather than per-page.
4. Grouping, when configured, is reflected in the returned page so a
   consumer can render groups without re-deriving them.
5. **No screener is executed.** A test using a run store whose execution
   path fails the test if reached demonstrates that a results read never
   reaches it — for a valid run, for an expired run, and for repeated
   paging.
6. An unknown or expired `run_id` produces an explicit error naming the
   `run_id` and stating that the screener must be run again; no run is
   executed as a side effect.
7. A run that matched nothing returns an empty page with a total of zero
   and full provenance, distinguishable from the unknown/expired error.
8. A request with no page size uses the documented default; a request
   above the hard maximum is rejected naming the maximum.
9. The returned provenance carries the run's own `as_of`, source,
   live/delayed status, timezone, currency, price adjustment policy,
   fundamentals reporting period, and calculation-engine version.
10. A cursor from a previous page returns the next contiguous rows; an
    unrecognized or malformed cursor is rejected rather than silently
    treated as the first page.
11. The use case reads only — it makes no workspace mutation and returns
    no mutation envelope.

## Design References

- `docs/design/results-and-explain/spec.md` — "Read a bounded page of
  results" scenarios in full.
- `docs/plan/EPIC-1010/T-1010-2-results-page-and-pinned-run-contract.md` —
  the page model, provenance, and the read contract this consumes.
- `docs/plan/EPIC-1010/T-1010-1-results-table-config-model.md` — the
  configuration whose columns and sort the projection applies.

## Technical Considerations

- AC5 is the epic's headline guarantee. Make the test genuinely
  discriminating: it must fail if the implementation is changed to rerun
  on a cache miss.
- Keep the use case thin — projection arithmetic belongs in the domain
  models from Wave 1, not here.
- Where a run has no results-table configuration yet, fall back to a
  documented default column set rather than failing.

## Out of Scope

- Explanations (T-1010-5).
- Mutating configuration or selection (T-1010-6).
- Transport, tool registration, and UI (T-1010-7, T-1010-8).
