# T-1011-7: `add_chart_annotation` tool

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Done
**Depends on**: T-1011-1
**Blocks**: T-1011-8, T-1011-9

## Description

`add_chart_annotation` lets an agent mark up the chart the way a human
would with a drawing tool — a trendline along the highs, a price level at
resistance, a shaded date range around earnings, a text label, or a
highlighted setup window. Annotations are how the agent points at
something instead of describing where to look.

## User Story

As a researcher reading an agent's analysis,
I want the agent to draw the trendline and shade the window it is talking
about,
so that I can see its claim on the chart instead of reconstructing it
from a paragraph of dates and prices.

## Acceptance Criteria

1. Each of the five annotation kinds can be added to a chart panel:
   trendline, price level, date range, label, and highlighted setup
   window.
2. Adding an annotation returns a stable annotation ID, and adding
   several annotations of the same kind yields distinct IDs.
3. Each kind accepts only the anchors it needs — a trendline two
   time-and-price points, a price level one price, a date range and a
   highlighted window a start and end time, a label a point and text —
   and a request carrying anchors that do not fit the kind is rejected
   naming what was expected.
4. An annotation anchored outside the chart's configured range is
   rejected with a message naming the chart's current range, rather than
   being added invisibly.
5. A date range or highlighted window whose end precedes its start is
   rejected; a price anchor that is not a finite number is rejected.
6. An annotation records the price-adjustment policy in force when it
   was created, and when the chart's adjustment policy later changes a
   price-anchored annotation is flagged as stale rather than silently
   re-plotted at a price that no longer means the same thing.
7. The call accepts `expected_revision` and `idempotency_key` and
   returns the mutation envelope with the new annotation's ID in
   `affected_ids` and an `undo_token` that removes it.
8. Annotations survive changes to the chart's visible range: scrolling a
   window away and back leaves the annotation attached to the same times
   and prices.
9. An optional label or note on any annotation kind is returned verbatim
   in subsequent reads of the chart's state.

## Solution Approach

Two new files, no domain changes — `chart/domain/annotations.ts` already
supplies `createAnnotation`, `validateAnnotationAnchors`, `isAnnotationStale`,
`staleAnnotationIds`, `annotationTimes` and `annotationPrices` for all five
kinds, and `chart/domain/chartState.ts` owns the annotation list and the
`ChartPriceAdjustment` vocabulary.

### `chart/application/chartAnnotations.ts`

The use-case layer. It contributes the three things the domain deliberately
does not know about:

1. **Range resolution.** A chart's configured range is either an explicit
   `{start, end}` or a relative token (`6mo`, `ytd`, `max`, …). Deciding
   whether an anchor falls inside a _relative_ range needs a "now", which
   makes it a use case rather than a pure domain function — so
   `resolveChartRange(range, now)` and `describeChartRange(range, now)` live
   here and take the injected `Clock`'s time. `max` resolves to `null`,
   meaning unbounded, and is the one range nothing can fall outside of.
   The rejection message names the resolved range, satisfying AC4.
2. **Anchor-shape triage.** The domain validates anchors _of a known kind_;
   it cannot report "you sent a price for a date range" because its anchor
   type is a discriminated union that already carries `kind`. So this layer
   compares the caller's anchor keys against the keys the kind requires and,
   on a mismatch, reports what was missing and what was foreign alongside the
   domain's own sentence describing what the kind expects. That sentence is
   obtained by asking `validateAnnotationAnchors(kind, undefined)` rather than
   copied, so the wording has exactly one definition (AC3).
3. **The `chart.add_annotation` operation.** `createAddChartAnnotationOperation`
   returns an EPIC-1006 `OperationDefinition`. Registering it there is what
   supplies `expected_revision`, `idempotency_key`, the mutation envelope and
   the undo token — none of that is reimplemented. `apply` mints the ID from
   the `IdSequencer` (`annotation_N`, AC2), appends to the panel's chart state
   through `writeChartState`, and returns an `inverse` draft whose document is
   the same state with that annotation removed, so the undo token removes
   exactly the drawing that was added (AC7).

Staleness (AC6) is surfaced by `readChartAnnotationsView(doc, panelId)`, which
returns each annotation with a `stale` flag computed against the chart's
_current_ `priceAdjustment`, plus the list of stale IDs. Annotations stamp the
policy in force at creation; a later policy change therefore flips the flag
without touching the stored anchors. `apply` also lifts stale IDs into the
draft's `warnings`, so the mutation envelope itself reports that earlier
drawings no longer mean what they did.

### `chart/tools/addChartAnnotation.ts`

`buildAddChartAnnotationTool(deps)` returns the single `add_chart_annotation`
`ToolSpec`. The handler resolves the workspace, then commits through
`applyOperations` so the registered operation — not a parallel code path — is
what actually runs. Typed EPIC-1006 errors map to `fail(...)` with their wire
form. The factory registers the operation into the injected registry only if
it is absent, so the tool is usable standalone while T-1011-9 remains free to
register it explicitly at the composition root.

The success payload carries the wire envelope, the created annotation verbatim
(including an optional `label`, AC9), the chart's current price-adjustment
policy, and the panel's full annotation list with per-annotation `stale` flags
— which is the read path AC6 and AC9 are observed through.

Anchors are stored in data coordinates only (ISO times and prices); nothing in
either module knows about pixels, so a visible-range change cannot move an
annotation (AC8).

## Design References

- `docs/design/chart-tools/spec.md` — "Annotate the chart" scenarios
- `docs/design/chart-tools/technical.md` — annotation contract
- `docs/reference/tool-spec.md` — the `add_chart_annotation` row

## Technical Considerations

- AC6 is the non-obvious one: a price level drawn on unadjusted prices is
  simply wrong once the chart switches to adjusted prices, and silently
  moving it is worse than flagging it. This is why the adjustment policy
  travels with the annotation.
- Annotation IDs feed `capture_chart_setup` (T-1011-8) and are how a
  human or agent will later remove or amend a drawing, so they must be
  stable from creation.

## Out of Scope

- Editing or removing existing annotations beyond the undo token — a
  general annotation-edit tool is not in the spec's core set.
- Drawing annotations on screen (T-1011-9).
- Annotations on non-chart panels.
