# T-1011-2: Study calculation engine with declared engine version

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Open
**Depends on**: —
**Blocks**: T-1011-5, T-1011-6, T-1011-9

## Description

`edit_chart_studies` puts studies on the chart and `get_chart_data`
returns their outputs, so both need the same arithmetic to produce the
same numbers. This ticket delivers the pure calculators for the studies
the spec names — moving averages, RSI, MACD, Bollinger Bands, VWAP, ATR —
over a bar series, together with the calculation-engine version string
that every market-data payload in this epic has to state.

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

## Design References

- `docs/design/chart-tools/spec.md` — "Manage studies" and "Read a
  bounded slice of the chart" behavioral sections
- `docs/reference/tool-spec.md` — the `edit_chart_studies` row names the
  study set; "Common contract" requires the calculation-engine version
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
