# T-0020-13: State the data as-of date on chart "no data" refusals

**Epic:** EPIC-0020
**Status:** Done

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

## Solution Approach

Implements the "Diagnosable chart data gaps" scenario from
`docs/design/workbench-composition-root/spec.md`.

- `src/lib/workbench/chart/infra/httpChartSeries.ts`'s `getBars()` throws
  `ChartSeriesError('unknown_instrument', ...)` on a 404 and
  `ChartSeriesError('source_unavailable', ...)` on other non-OK responses
  (~line 176-194) — both already name the instrument. Check whether
  `backend/api/routes/chart.py` (the endpoint these calls hit) already returns
  an as-of/coverage field in its response or error body; if so, thread it
  through `toTransportError`/the thrown `ChartSeriesError`'s message. If the
  backend does not expose this yet, check `PanelPriceSeriesPort`
  (`backend/infra/panel_market_data.py`) for whatever coverage/as-of metadata
  it already tracks for provenance elsewhere in the app (the same concept
  `discovery-and-catalog`'s tools already surface) and expose it on the 404
  response body rather than inventing a new metadata source.
- `src/lib/workbench/chart/application/chartData.ts`'s `series_unavailable`
  refusal (~line 605-606) currently just forwards `error.message` verbatim —
  once `httpChartSeries.ts`'s thrown message includes the as-of date, this
  path carries it through unchanged; only change this file if the date needs
  restructuring into the refusal's own fields rather than staying inline in
  the message string.
- Do not touch the legacy `src/lib/workbench/chart/components/ChartPanel.svelte`
  (the file with the literal old "no data loaded" string) — it's a different,
  unrelated feature (chart-comparison-series) not on the live panel-system
  route this ticket is about.
- If no backend as-of/coverage data is available at all for a given path, leave
  the message as it is today (already names the instrument) rather than
  fabricating a date — per the ticket's AC.

### Contracts to define

None — message content only, using data the backend likely already tracks for
provenance elsewhere.

## Implementation Notes

Backend already tracked the exact data needed, one layer down from where
this ticket first looked. `backend/api/routes/chart.py`'s `GET /api/chart/bars`
404 body did **not** carry an as-of date before this change, but
`PanelPriceSeriesPort.provenance()` (`backend/infra/panel_market_data.py`,
already built and tested for the backtest engine and `similarity`'s
provenance passthrough) already exposes the loaded panel's `as_of` — the
newest bar date in the panel (`PanelStatus.as_of`, the same field
`/api/panel/status` surfaces to the UI). No new metadata source was
invented; the 404 handler just calls the port it already depends on.

Changes:
- `backend/api/routes/chart.py` (`get_bars`, ~line 59-69): the 404 raised
  when `port.has_ticker(ticker)` is false now includes
  `"as_of": port.provenance().as_of.date().isoformat()` in the `detail` dict
  alongside the existing `message`.
- `src/lib/workbench/chart/infra/httpChartSeries.ts` (~line 128-220):
  `toTransportError` now takes the already-read response body instead of
  reading it itself (a body can only be consumed once, and the 404 path now
  needs to read it twice for two different purposes); a new
  `asOfDateFromBody()` helper parses the JSON body's `detail.as_of` (or
  `as_of`) field, returning `null` on any absence or parse failure so the
  instrument-naming message never regresses when no date is available. The
  `unknown_instrument` throw on a 404 appends
  `" This price source's data runs through <date>."` to its message only
  when a date was found.
- `src/lib/workbench/chart/application/chartData.ts`: no change — its
  `series_unavailable` refusal already forwards `error.message` verbatim, so
  the as-of date reaches the caller unchanged once httpChartSeries.ts states
  it.

Tests:
- `src/lib/workbench/chart/infra/httpChartSeries.test.ts`: two new cases —
  a 404 whose body carries `detail.as_of` produces a message containing that
  date, and a 404 without it produces the original, unchanged message.
- `src/lib/workbench/chart/application/chartData.test.ts`: one new case
  proving the `series_unavailable` refusal forwards an as-of date embedded
  in an underlying error's message unchanged (via a bespoke `ChartSeriesPort`
  double, since the existing in-memory fixture's `failure` option wraps the
  given error as `cause` behind its own fixed message rather than forwarding
  it — not what this pass-through test needed).
- `backend/tests/functional/test_chart_routes.py`: one new case asserting
  the 404 for an unknown ticker states the generated mock panel's actual
  max bar date as `as_of`, and still names the ticker in `message`.

Results: frontend `npx vitest run src/lib/workbench/chart` — 731 passed (32
files). Backend `uv run pytest tests/functional/test_chart_routes.py
tests/unit/test_panel_market_data.py` — 34 passed. `npm run typecheck` —
0 errors.
