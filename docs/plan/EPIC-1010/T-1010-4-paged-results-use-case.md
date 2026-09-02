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

## Solution Approach

### Why this cannot be built as a thin wrapper over `ResultsReader`

`ResultsReader.getResultsPage` (T-1010-2, `resultsReader.ts`) already pages a
run, but its `ResultRow` (`domain/page.ts`) deliberately carries only
identity + `rank` + `compositeScore` -- no `rankingValues`. Computing a
`catalog_field` or `computed_column` value needs the match's raw field data,
which only `ScreenerMatch.rankingValues` carries. So this use case reads
`PinnedRunStore` directly (same layer `resultsReader.ts` sits at), not the
`ResultsReader` port -- it needs data that port's return type doesn't expose.
This also matches the ticket's own file list (`PinnedRunStore`,
`createSpyPinnedRunStore` wraps `PinnedRunStore`) and resolves AC3: a
`ScreenerRun` already stores its *entire* match list (`run.ts`: "the whole
result set, not one page"), so the full set for a global sort/group pass is
just `run.matches` -- no repeated paged fetches through `getResultsPage`
needed, and no way to hit the port's own 200-row page-size ceiling while
assembling that full set.

### New files

- `src/lib/results/domain/projection.ts` (domain): the column/sort/group
  arithmetic (all of it, so the use case stays a thin sequencer).
  - `ColumnValue = number | string | boolean | null`.
  - `ProjectedRow extends ResultRow` (reuses `domain/page.ts`'s row, does not
    redefine it) `{ columns: Record<ResourceId, ColumnValue>; groupValue:
    ColumnValue }`.
  - `ProjectedResultsPage`: the same shape as `domain/page.ts`'s
    `ResultsPage` plus `rows: ProjectedRow[]` and `grouped: boolean`.
  - `defaultResultsTableConfig()`: the documented fallback for "no
    results-table configuration yet" -- empty `columns`/`computedColumns`,
    `sort: null`, `grouping: null`. With `sort: null` the projection keeps
    `run.matches`' existing order (already rank-ascending, deterministic),
    so the fallback is behaviorally identical to T-1010-2's un-projected
    page. This *is* "a documented default column set": the base identity
    columns every `ResultRow` already carries, nothing added.
  - A small recursive evaluator for `tableConfig.ts`'s `ExpressionNode`
    (tableConfig.ts exports only the parser/validator, per the ticket's own
    note) over a `(fieldId) => number | null` field getter backed by
    `match.rankingValues`. Any `null` operand makes the whole
    expression `null` (an honest "could not compute", never a fabricated
    0) -- same for division/`%` by zero. Functions are guarded against a
    local `Set` built from `tableConfig.ts`'s `PERMITTED_FUNCTIONS` (defense
    in depth beyond upstream validation): `abs`, `sqrt`, `round` unary;
    `ln` = natural log, `log` = base-10, both `null` for a non-positive
    input; `max`/`min`/`sum`/`avg` variadic, `null` on zero args.
  - Value resolution for a `ColumnIdentity`: `result_id` -> the row's
    `resultId`; `catalog_field` -> `match.rankingValues[fieldId] ?? null`;
    `computed_column` -> the row's precomputed value for that id. **Known
    gap, documented rather than papered over**: `ScreenerMatch` only carries
    field data for fields actually used in ranking
    (`rankingValues: Record<field_id, number|null>`) -- there is no general
    "read any catalog field for this instrument" port reachable from a
    synchronous, read-only projection. A `catalog_field` column referencing
    a field outside `rankingValues` resolves to `null`, matching this
    codebase's existing "honest absence, not a fabricated value" convention
    (e.g. `resultsReader.ts`'s ticker resolver). Not a regression this
    ticket introduces; a pre-existing shape constraint from Wave 1 that a
    real fix would touch `ScreenerMatch` itself (out of scope here).
  - Sort: computed once across the full projected set before any page is
    cut (AC3). Primary key then tie-break (`config.sort.tieBreak ??
    { source: 'result_id' }`, direction defaulting to `'asc'` -- matching
    `validateResultsTableConfig`'s own normalization, repeated defensively
    here in case an unvalidated config reaches this layer). **Tie-break by
    `result_id` compares by the row's numeric `rank`, not the `result_id`
    string.** `result_id` is `result_<runId>_<rank>` (`ids.ts`'s `mintId`
    grammar) -- lexicographic string comparison of that is not monotonic in
    rank once rank reaches two digits (`"...10"` sorts before `"...9"`).
    Rank is a bijective, monotonic surrogate for `result_id` within one run,
    so comparing by rank is the actually-correct implementation of "tie-break
    by result_id", not a divergence from it. Nulls sort after any non-null
    value under both `'asc'` and `'desc'` (missing data at the bottom,
    consistent with the rest of this area's "honest absence" stance) --
    numbers compare numerically, booleans `false < true`, everything else
    falls back to `String(...).localeCompare(...)`.
  - Grouping: `config.grouping.key` resolved once per row (via the same
    value-resolution function) into `ProjectedRow.groupValue`, carried
    per-row rather than restructuring the page into nested groups. AC4 asks
    only that grouping be "reflected in the returned page" so a consumer
    can render it "without re-deriving" -- a per-row group value satisfies
    that without inventing a second page shape (grouped vs. flat) that nothing
    else in Wave 1 defines. Ordering across groups is whatever `config.sort`
    produces; a config author who wants groups contiguous sorts by the same
    key primarily -- that's a configuration concern (T-1010-6), not this
    projection's.
  - `toWireProjectedRow` / `toWireProjectedResultsPage`: snake_case
    serializers matching `page.ts`'s convention, delegating to
    `toWireResultRow` and `toWireProvenance` rather than re-implementing
    either.

- `src/lib/results/application/getScreenerResults.ts` (application, thin
  sequencer, mirrors `resultsReader.ts`'s shape):
  1. `resolvePageSize(request.pageSize)` (`domain/page.ts`) -- reject
     (AC8) before touching the store.
  2. `store.getRun(runId)` -- `RunNotAvailable` (unknown/evicted) passes
     through unchanged (AC6); no other store call is made on this path, so
     an unknown/evicted `run_id` cannot become a write.
  3. Decode `request.cursor` if present via `domain/page.ts`'s
     `decodeCursor` (AC10) -- malformed or foreign-run cursors reject,
     never silently reinterpreted as page one.
  4. `projectResultRows(run, config ?? defaultResultsTableConfig(),
     resolveTicker)` (domain) -- the full, sorted, grouped, projected set.
  5. Slice `[offset, offset + pageSize)`, compute `nextCursor` via
     `encodeCursor` the same way `resultsReader.ts` does, return a
     `ProjectedResultsPage`.
  - Depends only on `PinnedRunStore` (`screener/ports.ts`) -- never
    `screener/engine/*` or `ScreenerEvaluationPort` -- so there is no member
    in this file's own dependency surface that could execute a screener
    (AC5's guarantee one layer up from the port's own structural absence).

### Tests

`src/lib/results/domain/projection.test.ts` and
`src/lib/results/application/getScreenerResults.test.ts`, mirroring
`resultsReader.test.ts`'s style (typed outcome narrowing, message-bearing
assertions). Covers, at minimum: AC1 (bounded page + total + cursor
presence/absence), AC2/AC3 (computed column + sort correctness across the
full set, not per page -- e.g. a 3-row page size against a run whose
configured sort inverts rank order), AC4 (`groupValue` present per row),
AC5 (the `createSpyPinnedRunStore` no-`putRun` test, for a valid run, an
evicted run via a custom `RunRetentionPolicy`, and a multi-page traversal),
AC6 (unknown run names the `run_id`), AC7 (empty run -> zero total, not an
error), AC8 (default page size; over-max rejection names the max), AC9
(provenance fields present, carried verbatim from `run.provenance`), AC10
(a valid cursor resumes correctly; a malformed one and a foreign-run one
both reject), AC11 (no mutation-envelope-shaped field on the outcome).
Each new test gets mutation-checked (temporarily revert the corresponding
fix/behavior, confirm red, restore) before the ticket is marked Done,
per the workflow instructions -- especially AC5's no-rerun test and the
AC8/AC10 boundary tests.
