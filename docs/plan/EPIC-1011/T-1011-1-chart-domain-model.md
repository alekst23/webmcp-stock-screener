# T-1011-1: Chart domain model, stable IDs, and captured-setup contract

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Done
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

## Solution Approach

Five pure modules under `src/lib/workbench/chart/domain/`, layered so the
dependency graph is acyclic at runtime:

```
instrument.ts   studies.ts        (leaves)
      \            |
       \           |   annotations.ts  (type-only edge back to chartState)
        \          |     /
         chartState.ts
               |
        capturedSetup.ts          (top of graph; the EPIC-1012 interface)
```

### `instrument.ts`

`InstrumentRef` (`instrumentId`, `symbol`, `exchange`, `assetType`) — a
value snapshot of EPIC-1008's `Instrument`, narrowed to what a chart and a
captured setup need. `assetType` reuses `AssetType` from
`src/lib/discovery/ports.ts` by type-only import so the two cannot drift.
`instrumentId` is validated with `isInstrumentId` from
`src/lib/surface/ids.ts` rather than a second competing scheme, which is
what makes "a bare ticker is never an identifier" enforceable here.

Also `NormalizationMode` (`none | percent_change | indexed_100 | z_score`),
`NormalizationAnchor` (`window_start | anchor_bar`), `Normalization`,
`DEFAULT_NORMALIZATION`, and `ComparisonRef` (`instrument` +
`normalization`) — comparisons live with the instrument they reference.
Helpers: `validateInstrumentRef`, `normalizeInstrumentRef`,
`validateComparisons`, `normalizeComparisons`.

### `studies.ts`

`StudyInstance` (`id`, `catalogItemId`, `params`, `pane`, `order`,
`enabled`), `StudyPane` (`price_overlay | sub_pane`), and pure transitions
returning `StudyTransition = { ok: true; studies; changes } | { ok: false;
issues }`:

- `addStudy(studies, instance)` — rejects a duplicate ID and an
  out-of-bounds `order`
- `updateStudyParams(studies, studyId, params)` — merges, keeps the ID
- `setStudyEnabled` / `toggleStudy` — keeps the ID and the params
- `reorderStudies(studies, orderedIds)` — requires a permutation of the
  existing IDs; renumbers `order` per pane
- `removeStudy(studies, studyId)` — closes the order gap, other IDs and
  relative order untouched

Plus `normalizeStudies` (normalize-on-read for reload) and
`sortStudiesForDisplay`. No import from the catalog: resolution of
`catalogItemId` to parameters and defaults is T-1011-5's job.

### `annotations.ts`

Anchors are modelled as a discriminated union carrying its own `kind`
(`TrendlineAnchors`, `PriceLevelAnchors`, `DateRangeAnchors`,
`LabelAnchors`, `SetupWindowAnchors`), and `ChartAnnotation` is built with
a generic `AnnotationOf<A>` that ties `kind` to `anchors['kind']`. That
makes "no kind can be constructed with anchors belonging to a different
kind" a compile-time guarantee, backed at runtime by
`validateAnnotationAnchors` (finite prices, ISO times, non-inverted
ranges, two distinct trendline points, non-empty label text).

`ChartAnnotation.priceAdjustment` stamps the policy in force when it was
drawn; `isAnnotationStale(annotation, policy)` and
`staleAnnotationIds(annotations, policy)` are how a policy change surfaces
as staleness rather than a silent re-plot. `annotationTimes` /
`annotationPrices` expose the anchors for the range check T-1011-7 does.

The module keeps a compile-time-exhaustive `Record<ChartPriceAdjustment,
true>` for its runtime membership check so it needs only a **type** import
from `chartState.ts` — no runtime cycle.

### `chartState.ts`

Scalar vocabulary: `ChartTimeframe`, `ChartCandleType`, `ChartScale`,
`ChartSession`, `RelativeRangeToken`, `ChartRange` (explicit
`{start, end}` or a relative token), and `ChartPriceAdjustment`
(`adjusted | split_adjusted | unadjusted`) with
`DEFAULT_CHART_PRICE_ADJUSTMENT` recorded, never implied.
`toProvenancePriceAdjustment` maps it onto `MarketDataProvenance`'s
narrower enum, documenting that `split_adjusted` collapses to `adjusted`
there and that the chart policy is always echoed alongside provenance
because the mapping is lossy.

`ChartConfig` and `ChartState` (`config`, `studies`, `annotations`).
Transitions: `applyChartConfigPatch(config, patch)` returns the new config
plus a `ChartConfigChange[]` of what actually changed, and
`invalidatesChartData(changes)` says whether cached bars/study output must
be dropped. Comparison slots: `addComparison`, `updateComparison`,
`removeComparison` reject an unknown instrument ID by name.

Storage helpers over `WorkspaceDocument.extensions.chart` — the single
door every sibling ticket uses: `readChartState`, `readChartStateOrNull`,
`readAllChartStates`, `writeChartState`, `removeChartState`,
`hasChartState`, `normalizeChartState`, `chartStateIdSeed`. All are pure
and return a new document; none mutates its input.

### `capturedSetup.ts`

The EPIC-1011 → EPIC-1012 interface, with a file header saying so.
Exports `CapturedChartSetup`, `SetupWindow`, `Normalization`,
`CapturedStudy`, `CapturedAnnotation`, `ComparisonRef`, `InstrumentRef`
(the last three re-exported from `instrument.ts`), the pure constructor
`buildCapturedSetup(input: CaptureInput): CapturedChartSetup`, and
`toWireCapturedSetup(setup): Record<string, unknown>` emitting the
snake_case names in technical.md and delegating provenance to
`toWireProvenance`.

`buildCapturedSetup` throws `CaptureSetupError` (a typed error with
`issues` and `toWireError()`) when there is no instrument or the window
has no bars, so a partial record is never produced. It copies every value
field by field rather than holding a reference, so reconfiguring or
deleting the source panel cannot change a captured record.

Persistence for setups is a second extension key, `chart_setups`, keyed by
setup ID, with `readCapturedSetups`, `readCapturedSetup`,
`writeCapturedSetup`, `normalizeCapturedSetup` and `capturedSetupIdSeed`
so T-1011-8 does not invent a competing store.

### Tests

`*.test.ts` beside each module, exercising every behavioral AC: partial
update leaves untouched fields alone (AC6), each rejection names its field
and leaves prior state unchanged (AC7), study IDs survive update, toggle
and reorder (AC3), each annotation kind validates its own anchors and
rejects foreign ones (AC4), ID generation through EPIC-1006's sequencer
does not collide and stays kind-prefixed across a reload seed (AC8), and a
captured setup survives its source panel being reconfigured or deleted
(AC5).

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
