# T-1011-2: Study calculation engine with declared engine version

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Open
**Depends on**: —
**Blocks**: T-1011-5, T-1011-6, T-1011-9

## Description

T-1011-5's chart-studies contract puts studies on the chart (through
EPIC-1007's `configure_panel_view`) and `get_chart_data` returns their
outputs, so both need the same arithmetic to produce the same numbers.
This ticket delivers the pure calculators for the studies the spec
names — moving averages, RSI, MACD, Bollinger Bands, VWAP, ATR — over a
bar series, together with the calculation-engine version string that
every market-data payload in this epic has to state.

## User Story

As an agent reading study values off a chart,
I want the number I read back to be the number the chart drew, computed
by a versioned engine,
so that my analysis is reproducible and I can tell when the engine
changed underneath a saved setup.

## Acceptance Criteria

1. Given a bar series and typed parameters, each of simple moving
   average, exponential moving average, RSI, MACD, Bollinger Bands, VWAP,
   and ATR produces output values aligned one-to-one with the input bars.
2. Bars inside a study's warm-up period produce an explicit "no value"
   rather than a zero, a repeated first value, or a shortened array, so
   an output index always refers to the same bar as the input index.
3. A study whose definition has several outputs (MACD line, signal,
   histogram; Bollinger upper, middle, lower) returns each output as a
   separately named series.
4. Parameters outside their valid range (non-positive period, period
   longer than the series, non-numeric input) are rejected with a message
   naming the parameter and its permitted range; no partial or silently
   clamped result is produced.
5. The engine exposes a version identifier, and that identifier changes
   whenever a calculator's output for a fixed input would change.
6. Each calculator's output matches hand-computed reference values for a
   fixed, checked-in input series, to a stated tolerance.
7. Recomputing the same study over the same series and parameters twice
   returns identical values.
8. VWAP resets on the boundary the requested session defines rather than
   accumulating across the whole series.
9. Nothing in this ticket performs I/O or imports from an
   infrastructure, tool, or component module.

## Solution Approach

### Shape

Two new domain files, pure and DOM-free:

- `src/lib/workbench/chart/domain/studyEngine.ts` — the public surface:
  `STUDY_ENGINE_VERSION`, the input/output types, parameter resolution
  against the catalog, the calculator lookup keyed by catalog item ID,
  and warning derivation.
- `src/lib/workbench/chart/domain/studyEngine/calculators.ts` — the seven
  pure array-in/array-out calculators, split out so neither file grows
  past the size limit.

Tests sit alongside as `*.test.ts`.

### Entry point

```ts
computeStudy(
  bars: readonly OhlcvBar[],
  catalogItemId: string,
  params?: StudyParamInput,
  options?: { registry?: CatalogRegistry }
): StudyComputation
```

`OhlcvBar` is a minimal structural type declared locally
(`{ time; open; high; low; close; volume }`) rather than imported from
T-1011-1, so this ticket has no sibling dependency; a later ticket adapts
its `StudyInstance` bars onto it.

`StudyComputation` carries `catalogItemId`, the fully resolved `params`,
`outputs` (a record keyed by the catalog's declared output names, each an
array of `number | null` with exactly `bars.length` entries),
`warmupBars`, `warnings`, and `engineVersion`.

Two non-throwing companions so the tool layer can validate without a
try/catch: `validateStudyParams(catalogItemId, params)` returning issue
strings for an `OperationDefinition.validate`, and `isStudySupported(id)`.

### Parameter resolution

Defaults, valid ranges, and enum members all come from
`resolveStudy(id)` in `src/lib/catalog/registry.ts`. Nothing about a
study's parameter metadata is duplicated here. An unknown parameter name,
a wrong value type, a non-finite number, or a value outside the catalog's
declared `range` raises `StudyParameterError` naming the parameter, the
offending value and the permitted range; no clamping, no partial result.
An unknown or non-study catalog ID raises `UnknownStudyError`.
Malformed bars (a non-finite value in a field the selected study reads)
raise `StudyInputError` naming the bar index and the field.

### Warm-up and alignment

Every output series is allocated at `bars.length` and pre-filled with
`null`. A calculator only ever writes at indices where its definition is
satisfied, so warm-up bars keep the explicit `null` — never a zero, a
back-filled first value, or a shortened array. Per-study minimums:
SMA/EMA/Bollinger `length`, ATR/RSI `length + 1` (both need a previous
close), MACD `slow + signal - 1`, VWAP 1.

Too few bars is a **warning, not an error**: the outputs come back
all-null and `warnings` states the study, the bars required and the bars
supplied. A partially defined multi-output study (MACD with enough bars
for the line but not the signal) gets a warning naming the outputs that
are entirely absent.

### Arithmetic

Standard published definitions, with the choices that vary between
implementations pinned here because the version constant covers them:
EMA seeded with the SMA of the first `length` closes and smoothed at
`2 / (length + 1)`; ATR and RSI use Wilder's smoothing seeded on the mean
of the first `length` true ranges / changes; Bollinger uses the
population standard deviation over the same window as its middle band;
MACD's signal is an EMA over the defined portion of the MACD line; VWAP
uses the typical price `(high + low + close) / 3` and resets on the
anchor boundary (`session` = calendar day, `week` = ISO week, `month` =
calendar month) rather than accumulating across the series.

### Version constant

`STUDY_ENGINE_VERSION` is the value T-1011-3 puts in
`MarketDataProvenance.calcEngineVersion`. Bump rule, documented at the
constant: MAJOR when any calculator's output for a fixed input and fixed
parameters would change (arithmetic, seeding, warm-up length, anchor
boundaries, default resolution); MINOR when a study or output is added
without moving any existing number; PATCH for changes that touch no
number at all (messages, warnings, types).

### Testing

Reference values are computed independently from the published
definitions — by hand for the cases that are hand-checkable (SMA,
Bollinger's variance, VWAP resets) and via an independent throwaway
script for the recursive ones (EMA, RSI, ATR, MACD) — then checked in as
literals with a stated tolerance. Each calculator is also asserted for
exact `null` warm-up placement, index alignment, and repeat-call
determinism.

## Design References

- `docs/design/chart-tools/spec.md` — "Manage studies" and "Read a
  bounded slice of the chart" behavioral sections
- `docs/reference/tool-spec.md` — `configure_panel_view` (this epic's
  chart-renderer contract is what it validates studies against for a
  `chart`-rendered panel) implies the study set; "Common contract"
  requires the calculation-engine version
- `src/lib/workspace/visualization.ts` — the existing convention of
  keeping numeric chart logic in a pure, DOM-free module with its own
  unit tests

## Technical Considerations

- The catalog (EPIC-1008) is the source of a study's parameter metadata
  and defaults. This ticket owns the arithmetic only; it must not embed a
  second catalog of study definitions. Keep the calculator lookup keyed
  by catalog item ID so T-1011-5 can resolve catalog item -> calculator
  without a hard-coded switch growing in the tool layer.
- Warm-up handling is the most common source of off-by-one bugs between
  a chart's drawn overlay and an agent's read values; AC2's index
  alignment is what makes the two agree.
- The engine version belongs in the provenance block T-1011-3 assembles,
  so expose it as a value, not a comment.

## Out of Scope

- Study instance state — IDs, ordering, enabled flags (T-1011-1).
- Resolving studies against the catalog (T-1011-5).
- Custom user-defined studies.
- Drawing study output (T-1011-9).
