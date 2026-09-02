# T-1014-10: Export a pinned run with provenance

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Done
**Depends on**: — (consumes EPIC-1010's pinned runs)
**Blocks**: T-1014-11
**Issue**: —

## Description

Deliver `export_results`: emit a pinned run's rows together with
everything needed to understand and reproduce them — the filter tree and
ranking that produced them, the universe, the run ID and timestamp, and
the full market-data provenance envelope.

An export without provenance is a screenshot with extra steps. The point
of this tool is that six months later someone can look at the file and
say exactly which screener revision, which run, which data source, and
which price-adjustment policy produced those rows.

## User Story

As a researcher taking work out of the app,
I want the export to carry the filters, the run, the timestamp, and the
data provenance with it,
so that the numbers stay interpretable — and reproducible — once they are
outside the workspace that made them.

## Acceptance Criteria

1. `export_results` accepts a pinned run ID and returns an export
   containing the run's result rows, the filter tree and ranking that
   produced them, the universe, the run ID, and the run timestamp.
2. The export states the full market-data provenance: `as_of`, source,
   live/delayed status, timezone, currency, price adjustment policy,
   fundamentals reporting period where fundamentals were included, and
   calculation-engine version.
3. The export identifies the exact screener revision the run executed, so
   it can be traced back to a reproducible definition.
4. Exporting never re-executes the screener. The exported rows match the
   pinned run exactly.
5. Exporting an unknown or expired run ID is rejected saying so; no run
   is executed to cover for the missing result.
6. A subset of columns can be selected for export, including computed
   fields; only those columns are exported and the provenance is
   unchanged.
7. For a large result set the export is bounded or paginated, and states
   plainly that it is a bounded subset, how many rows the run held, and
   how the exported rows were selected.
8. The export has a stable export ID, and the exported payload's
   structure is self-describing enough to be read without the app.
9. `export_results` writes nothing to disk and calls no external service;
   it returns a payload the app offers to the researcher as a download.
10. Exporting is read-only with respect to workspace state — it creates
    no revision-affecting mutation and requires no undo.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Export results"
  scenario table.
- `docs/reference/tool-spec.md` — `export_results` ("export the pinned run,
  filters, timestamp, and provenance"); the market-data provenance
  requirement listing every field an export must state.
- `docs/plan/EPIC-1010/_epic.md` — pinned `run_id` semantics, the
  no-silent-rerun guarantee, results-table column configuration, and the
  bounded-read conventions this follows.
- `docs/plan/EPIC-1009/_epic.md` — the screener revision, filter tree,
  ranking, and universe an export must describe.

## Technical Considerations

- The export destination is a working assumption recorded in the epic's
  Open Questions: a returned payload plus an app-offered download, with
  no filesystem or network side effect from the tool itself.
- If more than one export format is offered, the provenance must be
  present in all of them — a flat tabular format needs the provenance
  carried in a way a spreadsheet does not silently drop.
- Expired runs are the interesting failure case. Failing honestly is
  correct; re-running to produce "equivalent" rows would break the
  export's whole reason to exist.

## Solution Approach

`--skip-design-gate` was used for this ticket (authorized by the project owner for
this epic run); this section is the design record it substitutes for.

### Layout

New files under `src/lib/workbench/export/`, following the sibling epics' layered
layout (domain -> application -> tools):

- `domain/exportId.ts` -- a self-contained export-id generator (`export_<n>`).
- `domain/exportRun.ts` -- the `ScreenerRunExport` payload type, its snake_case wire
  serializer, the bounded-limit vocabulary (`EXPORT_DEFAULT_LIMIT`, `EXPORT_MAX_LIMIT`,
  `resolveExportLimit`), and `buildScreenerRunExport`.
- `application/exportResults.ts` -- the `exportResults(store, request, options)` use
  case: resolves the limit, reads the run, decodes an optional cursor, projects rows,
  resolves the requested column subset, and assembles the payload. No path in this
  module (or anything it calls) can execute or refresh a screener.
- `tools/exportResultsTool.ts` -- the `export_results` `ToolSpec`: `run_id` (required),
  `table_config` (optional wire `ResultsTableConfig`), `columns` (optional subset of
  `table_config`'s column ids), `limit`, `cursor`. No mutation envelope -- AC10 makes
  this a pure read, so there is no `change_id`/`new_revision`/`undo_token` to return.

### Reuse over reinvention

Column selection, computed-field evaluation, sorting and paging are **not**
reimplemented here. `exportResults` calls straight into the same machinery
`get_screener_results` (EPIC-1010) already uses:

- `results/domain/tableConfig.ts`'s `ResultsTableConfig`/`DisplayColumn`/`ComputedColumn`
  for column and computed-field description.
- `results/domain/projection.ts`'s `projectResultRows` for evaluating computed columns
  and resolving each configured column's value per row.
- `results/domain/page.ts`'s `encodeCursor`/`decodeCursor` for the bounded-read cursor
  grammar.
- `results/application/tableConfigWire.ts`'s `parseWireResultsTableConfig` for the
  tool's wire-to-domain `table_config` boundary.

An export therefore can never disagree with what the app itself would compute for the
same run and the same table configuration -- there is exactly one column-projection
implementation in the codebase, not a second one built for exports.

`export_results` reads a run through `PinnedRunStore.getRun`/nothing else. That port
has no execute/refresh member (`screener/ports.ts`), so nothing reachable from this
ticket's code can re-run a screener (AC4) -- the same structural guarantee
`get_screener_results` relies on. An unknown or evicted run comes back as
`RunNotAvailable` and is reported as a rejection (AC5); no fallback path exists that
could paper over it with a fresh run.

### Column selection and bounding

- `table_config` is optional; when omitted, `defaultResultsTableConfig()` is used
  (base identity columns only: `result_id`, `instrument_id`, `ticker`, `rank`,
  `composite_score`).
- `columns` (optional) names a subset of `table_config.columns[].id` to keep in each
  exported row's `values` map; an id that isn't in `table_config.columns` is rejected,
  naming the offending id(s), rather than silently ignored (AC6).
- Bounding reuses the page-cursor grammar rather than inventing a second one:
  `limit` (default `EXPORT_DEFAULT_LIMIT` = 500, hard max `EXPORT_MAX_LIMIT` = 5000 --
  larger than a UI page's 25/200 since an export is a deliberate bulk read, not a
  paged table render) and an opaque `cursor` from a previous export's
  `selection.next_cursor`. The response's `selection` object states `offset`, `limit`,
  `returned_count`, `total_available` (the run's full `returnedCount`), `bounded`, and
  `ordered_by`, satisfying AC7's "states plainly ... how many rows the run held, and
  how the exported rows were selected."

### Provenance, filter tree, ranking, universe

- `provenance` is `run.provenance` carried verbatim through `toWireProvenance` --
  never regenerated at export time.
- `filter_tree` and `ranking_spec` are `run.filterTree`/`run.rankingSpec`, the exact
  pinned snapshot the run executed (never the live screener, which can have moved
  past the run's revision) -- embedded as their existing domain (camelCase) shapes.
  No serializer converts the filter tree's 8-variant `Condition` union to snake_case
  anywhere in the codebase today; writing one for this ticket alone risked being both
  large (recursive, 8 variants, several nested value shapes) and unverified against a
  reference. Passing the domain shape through as-is is still fully self-describing
  JSON (AC8) -- a deliberate, documented scope decision, not an oversight.
- `screener_id` / `screener_revision` identify the exact revision executed (AC3).

### Known cross-epic gap: `universe`

`ScreenerRun` (`src/lib/screener/run.ts`, EPIC-1009/1010, already merged to `main`)
pins `filterTree` and `rankingSpec` exactly, but only `universeCount: number` -- the
resolved instrument count -- not the `UniverseSpec` (asset class, exchanges,
liquidity limits, exclusions, ...) that produced it. `engine.ts` computes
`universeResolution.instrumentIds.length` and discards the `UniverseSpec` it was
given; nothing else in the pinned-run contract retains it, and the *live* screener
definition is not a safe substitute (it can have moved past the run's pinned
revision -- the same reasoning `run.ts`'s own comment gives for why `filterTree`
isn't re-derived from the current screener either).

This ticket does not modify `run.ts` to add a pinned `universe: UniverseSpec` field --
that is already-merged sibling-epic code, and extending it is a cross-epic decision
this ticket does not self-approve. `export_results` instead states what is honestly
available today: `universe.instrument_count`, clearly labeled as a count, not a
fabricated or re-derived spec. Full reproducibility of AC1's "the universe" needs
`ScreenerRun` to pin the `UniverseSpec` itself, mirroring how it already pins
`filterTree`/`rankingSpec`; flagged here for the epic owner.

### Known cross-epic gap: stable export ID

`workbench/domain/ids.ts`'s `ResourceKind` enum (EPIC-1006, already merged) lists
`'workspace' | 'panel' | 'screener' | 'run' | 'result' | 'change' | 'undo' | 'link' |
'filter' | 'study' | 'annotation' | 'setup' | 'watchlist' | 'alert' | 'preview' |
'column' | 'rule'` -- evidently pre-provisioned for several not-yet-built EPIC-1014
tools (`watchlist`, `alert`, `setup`, `study`), but it has no `'export'` member, and
`IdSequencer.next()` is typed to that closed union, so `deps.ids.next('export')` does
not compile. Rather than extend that shared, already-merged enum unilaterally, this
ticket mints a self-contained export id (`domain/exportId.ts`, format `export_<n>`,
matching `mintId`'s grammar cosmetically but not registered in `RESOURCE_KINDS`).
AC8 ("a stable export ID") is satisfied; the id is just not currently parseable by
`ids.ts`'s own `parseId`/`isResourceId`. Flagged here for the epic owner -- adding
`'export'` to `ResourceKind` is a one-line, low-risk change but is a cross-epic file
this ticket does not self-approve touching.

### Testing

- `domain/exportRun.test.ts` -- payload shape, column-subset filtering, the
  `bounded`/`selection` accounting, wire serialization.
- `application/exportResults.test.ts` -- unknown/expired run rejection; column-id
  rejection; cursor paging; and the "no silent rerun" guarantee, reusing
  `results/testSupport.ts`'s `createSpyPinnedRunStore` to assert `putRun` is never
  called across an export or a paged export traversal (mirrors
  `getScreenerResults.test.ts`'s own AC5 tests). Mutation check: this test is proven
  to fail against a deliberately-reintroduced "helpfully re-run on miss" code path
  before being kept as a passing regression test against the real implementation.
- `tools/exportResultsTool.test.ts` -- wire input parsing/validation, table_config
  parsing via `parseWireResultsTableConfig`, and the tool-level wire shape.

## Out of Scope

- Uploading, emailing, or otherwise transmitting an export anywhere.
- Scheduled or recurring exports.
- Importing an export back into the app.
- Exporting backtest results, watchlists, or chart images — this ticket
  exports screener runs.
