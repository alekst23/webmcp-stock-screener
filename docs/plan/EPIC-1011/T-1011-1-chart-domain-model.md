# T-1011-1: Chart domain model, stable IDs, and captured-setup contract

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Open
**Depends on**: —
**Blocks**: T-1011-4, T-1011-5, T-1011-6, T-1011-7, T-1011-8, T-1011-9

## Description

Every other ticket in this epic reads or writes the same chart state, and
EPIC-1012 reads one type out of it. This ticket defines that state as
pure domain types and pure transition functions — chart configuration,
study instances, annotations, and the `CapturedChartSetup` record — with
no I/O and no dependency on the tool layer, the panel layer, or any data
source. Done looks like: the shape of a chart is fully described and
unit-tested, and four sibling tickets can proceed in parallel against it.

## User Story

As a developer implementing any chart tool in this epic,
I want one authoritative, side-effect-free description of what a chart is
and how it changes,
so that five tools mutate the same state consistently instead of each
inventing its own shape.

## Acceptance Criteria

1. A chart's configuration is representable with all of: the instrument
   it shows (by instrument ID, not ticker), timeframe, visible range,
   candle type, price scale, trading session, comparison instruments with
   their normalization mode, and price-adjustment policy.
2. The price-adjustment policy distinguishes at least fully adjusted,
   split-only adjusted, and unadjusted, and has an explicit default that
   is recorded rather than implied.
3. A study instance carries a stable ID, the catalog item it resolves to,
   its parameter values, its pane placement, its display order, and
   whether it is currently enabled. Updating parameters, toggling, or
   reordering a study preserves its ID.
4. An annotation is representable in all five kinds the spec names —
   trendline, price level, date range, label, highlighted setup window —
   each with a stable ID and typed anchors (time and/or price), and no
   kind can be constructed with anchors belonging to a different kind.
5. A `CapturedChartSetup` is representable with a stable setup ID,
   capture timestamp, source panel ID, instrument reference, historical
   window, timeframe, session, candle type, scale, normalization
   settings, ordered study instances, comparison instruments,
   price-adjustment policy, and a provenance block — with no field that
   requires re-reading the live chart to interpret.
6. Applying a partial configuration change leaves every field the change
   did not name unchanged, and returns both the new configuration and a
   description of what actually changed.
7. Applying a change that would produce an invalid chart (unknown
   comparison instrument slot, inverted date range, non-finite price,
   duplicate study ID, out-of-bounds display order) is rejected with a
   message naming the offending field, and the prior state is unchanged.
8. Two independently generated IDs of the same kind never collide within
   a workspace, and every generated ID is prefixed by its resource kind
   so an ID is self-describing in tool output.
9. Nothing in this ticket imports from an infrastructure, tool, or
   component module.

## Design References

- `docs/design/chart-tools/spec.md` — the "Configure the chart",
  "Manage studies", "Annotate the chart", and "Capture a reference setup"
  behavioral sections
- `docs/design/chart-tools/technical.md` — the `CapturedChartSetup`
  contract table; this ticket is its source of truth
- `docs/reference/tool-spec.md` — "Common contract for every tool" (stable
  IDs, never a bare ticker)
- `src/lib/workspace/store.ts` — the existing normalize-on-read
  resilience pattern to follow for state that will be persisted

## Technical Considerations

- EPIC-1006 owns the stable ID scheme, revision model, and provenance
  type. Consume them; if EPIC-1006 has not landed when this ticket
  starts, declare the minimum type surface this ticket needs and mark it
  for replacement by EPIC-1006's version in T-1011-9 — do not build a
  second competing scheme.
- `CapturedChartSetup` is a cross-epic contract: EPIC-1012's
  `find_similar_setups` consumes it. Any change to it after this ticket
  is a coordinated change, so err toward completeness now.
- Comparison instruments need a normalization mode (none, percent change
  from window start, indexed to 100, z-score) because comparing two
  differently priced instruments on one scale is meaningless without one.

## Out of Scope

- Computing study values (T-1011-2).
- Fetching bars or building provenance from a real source (T-1011-3).
- Any tool handler, schema, or registration (T-1011-4 through T-1011-8).
- Rendering (T-1011-9).
