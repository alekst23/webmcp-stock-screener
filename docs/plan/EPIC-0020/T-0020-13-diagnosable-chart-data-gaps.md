# T-0020-13: State the data as-of date on chart "no data" refusals

**Epic:** EPIC-0020
**Status:** Open

## Goal

A user dragged screener results to chart panels and some reported "no data
loaded" with no further explanation (observed live, 2026-09-04). Investigation
found the live chart path (`ChartPanelBody.svelte` / `chartData.ts` /
`httpChartSeries.ts`, not the legacy `ChartPanel.svelte` that literally has that
string) already names the unavailable instrument in its refusal message (e.g.
`unknown_instrument`: `This price source carries no data for instrument "X".`) —
the naming half of the request is already met. What's still missing is *when* —
the refusal doesn't state the data's as-of date/coverage window, so there's no way
to tell "this symbol will never have data here" apart from "this symbol's data
just hasn't been ingested through a given date yet."

This is a messaging improvement only — it does not fix the underlying cause of
those specific gaps (most likely the XUNK/reference-data gap tracked separately
in issue #32); see `docs/design/workbench-composition-root/spec.md`'s "Diagnosable
chart data gaps" section for the full behavioral spec.

## Acceptance criteria

- The `unknown_instrument` and `series_unavailable` chart-data refusal messages
  (`src/lib/workbench/chart/application/chartData.ts` /
  `src/lib/workbench/chart/infra/httpChartSeries.ts`) include the price source's
  data as-of date/coverage window where the backend already exposes it (the same
  provenance concept `discovery-and-catalog`'s tools already surface elsewhere),
  alongside the already-present instrument identification.
- If no as-of/coverage information is available for a given refusal path, the
  message still names the instrument as it does today — this ticket does not
  regress a message to be less specific for lack of a date.
- A test asserts the as-of date appears in at least one refusal message where the
  underlying source provides it.
