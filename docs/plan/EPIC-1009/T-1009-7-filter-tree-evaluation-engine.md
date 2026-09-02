# T-1009-7: Filter-tree evaluation engine

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: T-1009-2, T-1009-6

## Description

The engine that turns a screener definition into an ordered list of
matches: resolve the universe, evaluate every enabled condition against
market data, combine the results through the nested boolean tree, and
rank what survives. It also retains the per-condition evaluated value and
pass/fail state for every match, which is what later makes EPIC-1010's
per-filter explanation a lookup instead of a second evaluation.

## User Story

As a developer implementing `run_screener` and `validate_screener`,
I want one engine that evaluates a screener definition against market
data and returns ranked matches with their working shown,
so that both tools share the same semantics and a result can be explained
without re-deriving it.

## Acceptance Criteria

1. Resolving a universe applies inclusion criteria first, then liquidity
   limits, then exclusions, and reports the resulting instrument count.
2. Each of the eight condition types is evaluated against market data
   according to its typed operands, using the intervals, adjustments, and
   catalog items the condition names.
3. Boolean combination follows the tree: `AND` requires all children,
   `OR` requires any, and `NOT` inverts its single child, to arbitrary
   depth.
4. Disabled nodes are skipped entirely and never affect a match decision.
5. A ranking with a single field orders matches by that field and
   direction; a weighted ranking normalizes each field within the matched
   set before combining by weight; the declared tie-break resolves equal
   scores.
6. With no ranking set, matches come back in a documented, deterministic
   default order, and the engine reports that no ranking was applied.
7. Repeating the same evaluation of the same screener revision over the
   same data produces the same matches in the same order.
8. The result limit truncates the returned matches while the total matched
   count is still reported.
9. For every returned match the engine retains the instrument ID, its rank
   and composite score, each ranking field's value, and the evaluated
   value and pass/fail state of every enabled filter node keyed by node
   ID.
10. Every evaluation carries complete provenance — `as_of`, source,
    live/delayed status, timezone, currency, price adjustment, the
    fundamentals reporting period for any fundamental field used, and the
    calculation-engine version.
11. A field or calendar unavailable for part of the universe produces a
    reported warning rather than a silent pass or a silent drop.
12. The engine is an infra adapter behind the domain port; domain code
    does not import it. Tests exercise each condition type, nesting,
    disabled nodes, all three ranking modes, determinism, truncation, and
    the retained per-node values.

## Design References

- `docs/design/screener-core/technical.md` — what a run stores for
  EPIC-1010, and the domain-port/infra-adapter boundary.
- `docs/design/screener-core/spec.md` — "Set ranking" and "Run a
  screener" scenarios, and Open Question 3 on normalization.
- `backend/infra/pandas_engine.py` — the existing pandas adapter style
  (not to be modified).
- `backend/domain/contracts/engine.py` — the Protocol the adapter
  satisfies, in this epic's case T-1009-2's port.

## Technical Considerations

- Market data, reference data, fundamentals, and event calendars come
  through EPIC-1008's ports. Do not build a data pipeline or a mock
  dataset for them here.
- Keep evaluation of a single condition type in its own small unit;
  a per-type dispatch keeps each function within the size limits and makes
  the eight types individually testable.
- Retaining per-node values for every match is a memory cost — bound it by
  the result limit rather than retaining the whole universe.

## Out of Scope

The tools themselves (T-1009-8, T-1009-9), the run store and its
lifetime (T-1009-9), and result paging (EPIC-1010).

## Solution Approach

New directory `src/lib/screener/engine/`, all infra-adapter code behind
`ScreenerEvaluationPort` (`ports.ts`, T-1009-2). Nothing here is imported by
domain code; this package imports domain (`definition.ts`, `conditions.ts`,
`run.ts`, `validation.ts`, `ranking.ts`, `ports.ts`) and the catalog
(`catalog/registry.ts`, `catalog/types.ts`), never the reverse.

### Modules

- **`engine/unavailableMarketData.ts`** — `createUnavailableMarketData():
  ScreenerMarketData`. Every read resolves to "no data" (`resolveUniverse` →
  `[]`, `getFieldValue`/`getStudyOutput` → `null`, `getSeries` → `[]`,
  `detectPattern` → `null`) and `getProvenance()` reports a `'static'`
  provenance built with `makeProvenance` from
  `workbench/domain/provenance.ts`, naming
  `src.screener.market_data.unconfigured` as the source. Mirrors
  `discovery/unavailableDirectory.ts`.

- **`engine/conditionEvaluation.ts`** — one small evaluator per condition
  type behind a dispatch table, matching `conditionValidation.ts`'s
  per-family-file shape:
  `evaluateCondition(condition, instrumentId, deps: { marketData,
  registry }): Promise<ConditionEvalOutcome>` where
  `ConditionEvalOutcome = { passed: boolean; value: number|string|boolean|null;
  unit?: string; detail?: string; dataUnavailable: boolean }`.
  Before touching `marketData`, every evaluator resolves the condition's
  primary catalog item (field/study/pattern) through the injected
  `CatalogRegistry` and treats a non-`'available'` `DataAvailability` status
  as `dataUnavailable: true` — the catalog stays the single source of truth
  for "is this wired up" (AC11), and a per-instrument `null` read from
  `marketData` on an otherwise-available item is *also* `dataUnavailable`
  (a per-instrument gap, not a global one). `dataUnavailable` never implies
  `passed: true` (no silent pass).
  - `scalar`/`range`: `getFieldValue`, compared via the condition's typed
    operands and bound inclusivity.
  - `series_comparison`: `getSeries` on both `SeriesRef`s, compares the last
    two aligned points to detect the operator's crossing.
  - `temporal`: recursively derives a per-point boolean signal from its
    inner condition — `getSeries` on the inner field (scalar/range) or on
    both series (series_comparison), aligned by index — then scans the
    trailing `withinBars` points for a rising edge (`crossed_above`),
    falling edge (`crossed_below`), or any true point (`became_true`).
    An inner `pattern`/`relative`/`study_output`/`event_relative`/`temporal`
    has no derivable per-point series under this port and reports
    `dataUnavailable: true` with an explanatory `detail`.
  - `event_relative`: `getFieldValue(instrumentId, eventTypeId)`; a number
    is read as days-from-event, an ISO date string is diffed against
    `deps.now()`; compares against `windowDays` per `direction`.
  - `pattern`: `detectPattern`; `null` after an `'available'` catalog check
    is a genuine non-match (`passed: false`, not unavailable).
  - `relative`: resolves the baseline (`own_moving_average` via
    `getSeries` on the field itself; `peer_group`/`index` via
    `getFieldValue` on the baseline id) and compares `field / baseline`
    against `multiple`.
  - `study_output`: `getStudyOutput`, compared via `predicate`.

- **`engine/tree.ts`** — `evaluateFilterTree(root: FilterNode, instrumentId,
  deps): Promise<{ passed: boolean; nodeEvaluations:
  Record<ResourceId, FilterNodeEvaluation>; unavailableNodeIds: ResourceId[] }>`.
  Recursive walk: a disabled node (leaf or group) is skipped entirely —
  no recursion into a disabled group's children, no `FilterNodeEvaluation`
  emitted, no effect on its parent's combination (AC4). For each *enabled*
  node the walk records a `FilterNodeEvaluation` keyed by `nodeId`,
  groups included — a group's `value` is `null` (no scalar form) and its
  `detail` summarizes child pass counts. `AND` requires every enabled
  child, `OR` requires any, `NOT` inverts its one enabled child; a group
  with zero enabled children (all children disabled, or an empty group —
  the default empty screener's root) is vacuously `true` for every op,
  documented inline, so an all-disabled or empty tree matches everything.

- **`engine/ranking.ts`** — `applyRanking(instrumentIds, ranking:
  RankingSpec | null, marketData, registry): Promise<{ ranked:
  RankedInstrument[]; rankingApplied: boolean; normalization: string | null;
  unavailableFieldIds: string[] }>` where `RankedInstrument = { instrumentId;
  compositeScore: number | null; rankingValues: Record<string, number|null> }`.
  `ranking === null`: default order is instrument ID ascending
  (lexicographic) — documented here and in a code comment —
  `rankingApplied: false`, `compositeScore: null` for every match,
  `normalization: null`. Otherwise: read each `RankingField`'s raw value
  via `getFieldValue` for every instrument (`rankingValues`, keyed by
  `fieldId`, always raw); normalize each field within the matched set per
  `ranking.normalization` (`percentile_rank`: `(below + 0.5*equal) / n`,
  well-defined for `n === 1`; `z_score`: population mean/stddev, `0` when
  stddev is `0`; `min_max`: `(v - min) / (max - min)`, `0.5` when
  `max === min`) — all three land in/near `[0, 1]` so mixed-direction
  fields combine predictably; a field's `'asc'` direction inverts its
  normalized contribution (`1 - x` for percentile/min-max, `-x` for
  z-score) so a higher `compositeScore` always means "better" regardless of
  each field's direction; composite is the weight-sum of available fields
  (a `null` raw value excludes that field from the sum for that instrument
  and is reported in `unavailableFieldIds`). Final order: `compositeScore`
  descending, then `ranking.tieBreak`'s raw field value/direction, then
  `instrumentId` ascending as the last, always-decisive tiebreaker (AC7).
  `DEFAULT_RANKING_LIMIT` from `../ranking.ts` is reused for the `ranking
  === null` case so an unranked run still bounds its result.

- **`engine/universe.ts`** — `resolveEngineUniverse(universe, marketData):
  Promise<{ instrumentIds: string[]; warnings: ScreenerWarning[] }>`.
  A thin wrapper: `ScreenerMarketData.resolveUniverse` is the one port call
  and is documented (`ports.ts`) to receive the whole `UniverseSpec`, so
  AC1's inclusion → liquidity → exclusion ordering is a property of
  whatever implements that port (out of scope here — "do not build a data
  pipeline"); this module reports the resulting count via
  `instrumentIds.length` and appends a `PROBLEM_CODES.emptyUniverse`
  warning when the result is empty.

- **`engine/engine.ts`** — `createScreenerEngine(deps: {
  marketData: ScreenerMarketData; registry?: CatalogRegistry;
  validateDefinition?: (definition: ScreenerDefinition) =>
  Promise<ScreenerValidationReport>; now?: () => Date }):
  ScreenerEvaluationPort`. `registry` defaults to `builtinCatalogRegistry`,
  `now` to `() => new Date()`. `validate` delegates to
  `deps.validateDefinition`, defaulting to a minimal structural validator
  built from `parseScreenerForExecution` (`validation.ts`) plus a walk that
  calls `validateCondition` (`conditionValidation.ts`) on every *enabled*
  condition node, collecting `skippedNodeIds` from disabled nodes — no
  contradiction detection or cost estimation (T-1009-8's job). `execute`:
  1. Validate; any `severity: 'blocking'` problem returns a
     `ScreenerRunRefusal` with the full problem list — no `runId` minted.
  2. `resolveEngineUniverse` → `universeCount`, universe warnings.
  3. `evaluateFilterTree` for every universe instrument; keep the full
     per-instrument result (`nodeEvaluations` included) only for instruments
     that passed — this is the AC12 bound: the transient map's size is the
     matched-set size, never the universe size. `matchedCount` is this set's
     size.
  4. `applyRanking` over the matched instrument IDs.
  5. Slice to `ranking.limit` (or `DEFAULT_RANKING_LIMIT` when unranked) →
     `returnedCount`, `truncated`. Build each `ScreenerMatch` from the
     sliced ranked list plus the matched-set map entry for that instrument
     id — entries for matched-but-not-returned instruments are never read
     out of the map.
  6. Warnings: universe warnings, a zero-match warning when
     `matchedCount === 0`, one `PROBLEM_CODES.unavailableData` warning per
     filter node that had at least one instrument with
     `dataUnavailable: true` (naming the node via `nodeIds`), and one for
     ranking fields with any unavailable value across the matched set.
  7. `provenance` from `marketData.getProvenance()`; `createdAt` from
     `deps.now()`.
  8. Assemble and return via `makeScreenerRun` (`run.ts`), which enforces
     the `truncated`/`returnedCount`/rank-contiguity invariants.

### Test plan

- `unavailableMarketData.test.ts` — every method resolves to the honest
  "not wired up" shape; `getProvenance()` is `'static'`, never `'delayed'`.
- `conditionEvaluation.test.ts` — one `test_<type>_<condition>_<passOrFail>`
  per condition type using small in-test fake `ScreenerMarketData` +
  `CatalogRegistry` objects (never `builtinCatalogRegistry`'s real
  "unavailable" patterns, so both the pass and the `dataUnavailable` path
  are exercised per type); a catalog item marked `'unavailable'` produces
  `dataUnavailable: true` and `passed: false`; a `getFieldValue` returning
  `null` on an `'available'` item does too.
- `tree.test.ts` — `AND`/`OR`/`NOT` each with passing and failing children;
  nesting to 3+ levels; a disabled leaf inside an enabled group (group
  ignores it); a disabled group (its subtree produces no evaluations at
  all); an empty/all-disabled group evaluates `true`; asserts a **group**
  node's own `FilterNodeEvaluation.passed` is recorded, not just its leaves
  (AC9).
- `ranking.test.ts` — single-field ascending and descending; weighted
  multi-field composite for each of the three normalizations; a declared
  tie-break resolving an exact score tie; `ranking: null` giving
  instrument-ID order and `rankingApplied: false`; a `null` raw value
  excluded from the composite and reported unavailable; determinism
  (two calls over the same fake data produce identical order).
- `universe.test.ts` — a fake `resolveUniverse` returning a list reports
  that count; an empty result appends the empty-universe warning; a
  non-empty result appends none.
- `engine.test.ts` — `execute()` end-to-end over a small fake universe:
  a multi-node AND/OR tree with a disabled node; truncation
  (`matchedCount > returnedCount`, `truncated: true`); AC9 — every returned
  match's `nodeEvaluations` covers every enabled node, group included;
  AC11 — a field unavailable for one of several instruments produces a
  `ScreenerWarning` naming that node, and the instrument is not silently
  dropped or silently passed; a blocking validation problem (unknown
  condition type) refuses the run with no `runId`; determinism (repeated
  `execute()` over the same definition/data yields identical
  `matches`); zero-match run returns `matchedCount: 0` with a warning, not
  an error.
