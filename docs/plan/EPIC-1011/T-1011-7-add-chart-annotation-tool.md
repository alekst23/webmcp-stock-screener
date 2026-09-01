# T-1011-7: `add_chart_annotation` tool

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Open
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
