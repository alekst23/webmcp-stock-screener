# T-1011-6: `get_chart_data` bounded read

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Open
**Depends on**: T-1011-1, T-1011-2, T-1011-3
**Blocks**: T-1011-9

## Description

`get_chart_data` lets an agent read the actual OHLCV values and study
outputs behind what the chart is showing, so it can reason about the data
rather than describe the picture. Boundedness is the point of the tool,
not a safeguard bolted on: an agent must not be able to pull an unbounded
series, in one call or by looping.

## User Story

As an agent asked whether the RSI diverged from price at the recent high,
I want to read a specific, bounded slice of the visible bars and the
studies on them,
so that I can answer from numbers, while the human's context and the
page's memory stay finite.

## Acceptance Criteria

1. Given a chart panel ID and a bounded window, the tool returns OHLCV
   values for the bars in that window and the output series of the
   chart's enabled studies over the same bars, indexed so a study value
   and its bar line up.
2. A window can be expressed as an explicit start and end, as the last N
   bars, or as N bars either side of an anchor time; a request naming no
   window at all defaults to the chart's currently visible range and
   says so in the result.
3. The response never exceeds a documented per-call bar cap, and the cap
   is stated in the result and in the tool's own description.
4. A request whose window resolves to more bars than the cap is refused,
   not truncated: the result states the cap, how many bars the window
   actually contains, and at least two concrete remedies — narrow the
   window, or request a coarser aggregation that fits.
5. When the caller requests a coarser aggregation to fit a wide window,
   the returned bars are explicitly labelled as aggregated, with the
   aggregation applied, rather than passed off as raw bars.
6. The tool never returns a continuation cursor or any other affordance
   that lets an agent reassemble an unbounded series by looping; every
   call must be independently bounded by the caller.
7. A request for a window outside the chart's configured range is
   refused with a message directing the caller to change the chart
   configuration first, so reads cannot silently reach past what the
   human can see.
8. The response carries the full provenance block — `as_of`, source,
   live/delayed status, timezone, currency, effective price-adjustment
   policy, and calculation-engine version — and the adjustment policy
   reported matches the one the bars were computed under.
9. Bars inside a study's warm-up period report an explicit absent value
   rather than a substituted number.
10. The tool is a read: calling it does not change the workspace
    revision, does not mutate the chart, and does not require
    `expected_revision`.
11. An empty window (a market holiday, an instrument with no data in
    range) returns an empty series with valid provenance, not an error.

## Design References

- `docs/design/chart-tools/spec.md` — "Read a bounded slice of the
  chart" scenarios, including every refusal case
- `docs/design/chart-tools/technical.md` — bounded-read request and
  response contracts
- `docs/reference/tool-spec.md` — the `get_chart_data` row ("Read a bounded
  range…") and the market-data provenance requirement

## Technical Considerations

- The cap is a stated constant, not a magic number scattered across
  handlers; the epic's Open Questions record 500 bars as the working
  assumption and the reasoning behind it.
- AC6 is the part that is easy to get wrong. Pagination looks helpful and
  quietly re-creates the unbounded pull the spec forbids: an agent that
  can ask for "the next page" indefinitely has an unbounded series. The
  caller narrowing its own window is the intended interaction.
- AC7 keeps the human and the agent looking at the same evidence — an
  agent that wants more history changes the chart, visibly, first.

## Out of Scope

- Changing the chart (T-1011-4, T-1011-5).
- Screener result reads (EPIC-1009's `get_screener_results`).
- Exporting data.
