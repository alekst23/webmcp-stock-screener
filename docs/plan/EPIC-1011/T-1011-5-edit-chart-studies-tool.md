# T-1011-5: Chart studies contract (add/update/reorder/toggle/remove)

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Done
**Depends on**: T-1011-1, T-1011-2
**Blocks**: T-1011-8, T-1011-9

## Description

This is how an agent puts indicators on a chart and keeps them tidy:
adding, updating, reordering, toggling, and removing study instances such
as moving averages, RSI, MACD, Bollinger Bands, VWAP, and ATR. It is no
longer a standalone `edit_chart_studies` tool — it is the study-editing
half of the chart-renderer contract this ticket registers into EPIC-1007's
source/renderer registry, reached through EPIC-1007's generic
`configure_panel_view` for a `chart`-rendered panel. Every study is
resolved through EPIC-1008's catalog, so parameters are validated against
real metadata instead of a hard-coded list.

## User Story

As an agent building a chart for a specific thesis,
I want to add and adjust several studies in one revision-checked call
and get their stable IDs back,
so that I can refer to exactly the RSI I added when I later change its
period or read its values — through the same `configure_panel_view` tool
I use to configure any other panel's view.

## Acceptance Criteria

The following criteria describe the contract's behavior; "the call" means
a study-editing operation reached through EPIC-1007's
`configure_panel_view` for a `chart`-rendered panel.

1. A study can be added by catalog item ID with explicit parameters, or
   with parameters omitted, in which case the catalog's defaults are
   applied and reported in the result.
2. Adding a study returns a stable study instance ID; the same catalog
   item can be added more than once (for example two moving averages of
   different periods) and each instance gets its own ID.
3. A study's parameters can be updated by instance ID, and the instance
   keeps the same ID afterwards.
4. Studies can be reordered, and a study can be toggled off and back on;
   neither operation changes any instance ID, and toggling off preserves
   the instance's parameters.
5. A study can be removed by instance ID; removing it does not disturb
   the IDs or order of the remaining studies.
6. Several operations submitted in one call are applied atomically — if
   any operation is invalid, none is applied and the result names which
   operation failed and why.
7. A catalog item ID that does not exist, or is not applicable to the
   chart's instrument or timeframe, is rejected with a message that
   names the item and directs the caller to catalog search.
8. Parameters outside the catalog's declared valid range are rejected
   with the parameter name, the supplied value, and the permitted range.
9. Each study is placed on the pane the catalog declares — overlaid on
   price or in its own sub-pane — rather than a placement guessed by the
   tool.
10. The call accepts `expected_revision` and `idempotency_key` and
    returns the mutation envelope, with `affected_ids` listing every
    study instance the call created, changed, or removed, and an
    `undo_token` that restores the previous study set exactly.
11. Adding a study whose warm-up period exceeds the chart's visible
    range succeeds but returns a warning saying the study will have no
    plotted values in the current range.

## Solution Approach

Two deliverables, no standalone WebMCP tool.

### 1. `chart/application/chartStudies.ts` — the batch fold and the operation

A single exported fold, `applyStudyOperations(state, operations, ids, options)`,
is the one implementation of study editing. It walks the batch, threading the
study list from one operation to the next, and returns either an outcome
(studies, affected IDs, changes, warnings, resolved parameters) or a failure
naming the failing index, the operation, and why. Each step delegates to the
existing pure transitions in `chart/domain/studies.ts` — `addStudy`,
`updateStudyParams`, `setStudyEnabled`, `toggleStudy`, `reorderStudies`,
`removeStudy` — so instance IDs are preserved by construction (AC2-AC5).

The batch operation shapes are `add`, `update`, `reorder`, `toggle`, `remove`.
`add` deliberately does **not** accept a `pane`: placement is derived, never
supplied (AC9).

Parameter resolution is not reimplemented. `resolveStudyParams` /
`validateStudyParams` from `chart/domain/studyEngine` already resolve defaults
and enforce the catalog's declared ranges, enums, units and cross-parameter
constraints, and their `StudyParameterError` message already names the
parameter, the supplied value and what would have been accepted (AC1, AC8).

`OperationDefinition<EditChartStudiesInput>` with kind `chart.edit_studies` is
registered into EPIC-1006's operation registry. That supplies
`expected_revision`, `idempotency_key`, the mutation envelope, atomic apply and
the undo token (AC10) — none of it is reimplemented here. `validate` runs the
same fold against a throwaway ID sequencer seeded from `chartStateIdSeed`, so
validation never advances the real sequencer and never collides with a live ID.
`apply` re-runs the fold and throws `OperationValidationError` on the first bad
operation, which leaves the stored document untouched because
`applyOperations` folds inside `RevisionService.commit`'s `mutate` (AC6). The
draft's `inverse.document` is the pre-batch document, so undo restores the
previous study set exactly.

### 2. `chart/tools/chartStudiesContract.ts` — the renderer's study half

Exports a self-contained `RendererConfigContribution` (`configSchema`,
`validateConfig`, `defaultConfig`) covering the `studies` key of the
`chart_grid` renderer's view configuration, plus `composeRendererWithStudies`
and `registerChartStudiesContract` so wiring it into EPIC-1007's registry is
one line. Nothing is imported from EPIC-1007 or from T-1011-4's renderer
module; the registry and renderer-definition interfaces are declared
structurally. `validateConfig` delegates to the same catalog resolution, pane
derivation and parameter validation the operation uses — one implementation,
two entry points.

### Pane placement is derived, not declared (AC9)

The catalog has no `pane` field, so `derivePane(item)` reads the metadata it
does declare. A study shares the price axis only when the catalog gives both
signals: the item is tagged `overlay`, **and** every declared output is in
price units (`unit === 'currency'`) with none bounded like an oscillator
(a `range` with both `min` and `max` on a non-price output). Anything else gets
its own sub-pane. Defaulting to a sub-pane is the safe direction: a study in
its own pane is never wrong, whereas overlaying a non-price series onto price
squashes the price axis. Over the catalog on `main` this yields the
conventional placement — SMA, EMA, Bollinger Bands and VWAP on price; ATR, RSI
and MACD in sub-panes — without a per-study-ID table, so a new catalog study
lands on the right pane with no edit here.

### Catalog applicability (AC7)

`resolveStudy` miss → rejection naming the item, listing `suggestCatalogIds`
matches and directing the caller to `search_catalog`, so a bad call
self-corrects in one turn. A study the chart's engine cannot plot
(`isStudySupported` false) and a study whose catalog `availability.intervalIds`
excludes the chart's current timeframe are rejected the same way. An empty
`intervalIds` list means "no interval constraint stated", not "no interval
allowed".

### Warm-up warning (AC11)

`estimateVisibleBars(config)` divides the visible span by the timeframe's bar
seconds. For a relative token whose span depends on today's date the widest
possible span is used, and `max` yields no estimate at all, so the warning can
under-report but never mis-fires. The warm-up itself is not restated here: the
engine is asked over a placeholder series of exactly that length, and a study
whose every output is absent across the whole estimated range earns the
warning. Warm-up length is a property of the arithmetic and the engine exports
no number for it; asking the engine is how we get the exact answer without a
second copy of the rule.

## Design References

- `docs/design/chart-tools/spec.md` — "Manage studies" scenarios
- `docs/design/chart-tools/technical.md` — study instance contract
- `docs/reference/tool-spec.md` — the `configure_panel_view` and
  `describe_catalog_item` rows
- `docs/plan/EPIC-1007/T-1007-7-panel-source-renderer-registry.md` — the
  registry interface this contract implements
- `src/lib/webmcp/tools.ts` — the existing convention of returning the
  available catalog on a resolution failure so a bad call becomes a
  one-turn self-correction rather than a retry loop

## Technical Considerations

- EPIC-1008 owns the catalog. Resolve parameters, ranges, defaults,
  outputs, and pane placement through it; do not embed a study catalog
  in this contract.
- T-1011-2 owns the arithmetic and is keyed by catalog item ID, so this
  contract maps instance -> calculator without a growing switch statement.
- AC6's atomicity matters because agents batch study edits; a partially
  applied batch leaves a chart no one asked for and an undo token that
  cannot describe it.
- This ticket does not register a WebMCP tool of its own — EPIC-1007's
  `configure_panel_view` is the tool an agent calls; it resolves to this
  contract's logic for a `chart`-rendered panel via EPIC-1007's
  source/renderer registry (T-1007-7). If T-1007-7 has not landed when
  this starts, code against the agreed contract shape and use a test
  double.

## Out of Scope

- Study arithmetic (T-1011-2) and the catalog itself (EPIC-1008).
- Custom user-defined studies.
- Returning study values to the agent (T-1011-6).
- Drawing studies (T-1011-9).
