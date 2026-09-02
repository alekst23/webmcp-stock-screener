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

## Solution Approach

Two new files, both owned by this ticket:

- `src/lib/workbench/chart/application/chartData.ts` — the use case:
  window resolution, the cap check, aggregation, study alignment, and the
  single `toWireChartData` serializer.
- `src/lib/workbench/chart/tools/getChartData.ts` — the `get_chart_data`
  `ToolSpec`, exported through a `buildGetChartDataTool(deps)` factory.
  T-1011-9 owns registration; nothing here reaches a composition root.

### Shape of the use case

`readChartData(deps, request)` returns a discriminated outcome —
`{ok: true, data}` or `{ok: false, refusal}` — rather than throwing, because
almost every acceptance criterion here is a _refusal_ with structured detail
the agent must be able to act on, and an exception per refusal reason would
be five error classes carrying the same payload.

Dependencies are explicit: `{repository, series, clock, registry?}`. The
clock is needed because a chart's range may be a relative token (`6mo`),
and a relative token cannot be turned into an explicit window without
"now".

Pipeline:

1. Resolve the workspace document and the panel's `ChartState` through
   `readChartStateOrNull` — never through `extensions` directly. Missing
   panel, or a chart with no instrument, is a refusal.
2. Resolve the chart's configured range to an explicit `{start, end}`.
3. Resolve the requested window form against that range.
4. Fetch bars through `ChartSeriesPort`.
5. Aggregate, if a coarser timeframe was asked for.
6. Check the cap against the bars that would actually be returned.
7. Compute the chart's enabled studies over exactly those bars.
8. Assemble bars, aligned study outputs, price-adjustment block,
   provenance and warnings.

### Window resolution (AC2, AC7)

Four forms, exactly one per call:

| Form                                     | Resolution                                             |
| ---------------------------------------- | ------------------------------------------------------ |
| none                                     | the chart's resolved visible range; the result says so |
| `{start, end}`                           | used as given, after a containment check               |
| `{last_n_bars}`                          | the last N bars _inside_ the chart's range             |
| `{anchor_time, bars_before, bars_after}` | a slice around the anchor bar                          |

Only the explicit form can name times of its own, so only it needs the
containment check: a window that starts before, or ends after, the chart's
resolved range is refused naming the chart's range and directing the caller
to reconfigure the chart first (AC7). The three count-based forms are
resolved _by slicing bars already inside the chart's range_, so they cannot
reach past it by construction.

Slicing needs bar positions, which needs bars, so the count-based forms
fetch the chart's resolved range and slice in memory rather than guessing a
window from a nominal bar duration. Guessing would be wrong across
holidays, half-days and weekends — the calendar the source actually keeps
is not derivable from the timeframe. The fetch is still bounded by the
chart's own configuration, which is precisely the bound the design gives
reads: never past what the human can see.

A count-based form asking for more bars than exist inside the range is
satisfied with the bars that do exist plus a warning. That is not the
truncation AC4 forbids — nothing was silently dropped from a window the
caller named; the window simply ran out of chart.

### The cap (AC3, AC4)

`CHART_DATA_BAR_CAP = 500`, exported once from `chartData.ts` and
interpolated into the tool description, so the number appears in exactly
one place in the source. Stated in every successful result as `bar_cap`.

The check runs on the bars that would be returned — after aggregation, so
"aggregate to fit" is a real remedy rather than advice that changes
nothing. Over the cap is a refusal, never a truncation: the payload carries
`bar_cap`, `bars_in_window`, and a `remedies` array holding at least a
narrowing remedy and an aggregation remedy. The aggregation remedy is
computed, not boilerplate — the coarser timeframes are rolled up for real
and only those whose resulting bar count fits are offered, so the agent is
never told to aggregate to something that would be refused again.

### No pagination (AC6)

Deliberately absent, and tested for. The response has no cursor, no
`has_more`, no `next_page`, no `offset`, and no token of any kind; a test
walks the serialized payload's keys and fails on any of those names. A
"next page" affordance would let an agent reassemble an unbounded series by
looping, which is the exact outcome the whole tool exists to prevent. The
intended interaction is that the caller narrows its own window. The result
carries a `boundedness` sentence saying so, so an agent that goes looking
for pagination finds an explanation instead of nothing.

### Aggregation (AC5)

`aggregate_to` must be strictly coarser than the chart's timeframe; equal
or finer is refused, since neither can be produced from the bars on hand.
Roll-up is the standard OHLCV fold — first open, max high, min low, last
close, summed volume — bucketed by calendar period for daily and coarser
timeframes and by fixed duration for intraday ones. Aggregated bars are
labelled: `aggregated: true` plus an `aggregation` block naming the source
timeframe, the target, the method and the source bar count, and the result's
`timeframe` reports the timeframe of the bars actually returned while
`source_timeframe` reports the chart's. Studies are computed over the
aggregated bars, because those are the bars the values are aligned to.

### Studies and alignment (AC1, AC9)

Only enabled studies, in display order. Each is computed with `computeStudy`
over the returned bars, so every output series has exactly one entry per bar
and index `i` of any series belongs to bar `i`. Warm-up bars are whatever
the engine produced, which is `null` — never substituted, never filled
forward. A study the engine cannot compute (unsupported item, bad stored
parameter) degrades to an entry with empty outputs and a warning rather
than failing the whole read: one broken study should not cost the agent its
prices.

### Provenance and adjustment (AC8)

The port's provenance travels through untouched, serialized by
`toWireProvenance`. Alongside it the result carries a `price_adjustment`
block with `chart_policy` (what the chart is configured for) and `applied`
(what the bars were actually computed under). `applied` is `null` when the
source states no basis — the null is passed through explicitly and the
port's own warning about it is relayed. It is never defaulted to the
requested policy, because a guessed basis is the misreport the provenance
contract exists to prevent. Both fields are needed because provenance's
enum has no `split_adjusted`.

### It is a read (AC10)

The use case never calls `repository.put`. The tool's input schema has no
`expected_revision` property, and a call that supplies one anyway is
refused saying the tool is a read — silently ignoring it would let an agent
believe it had a concurrency guarantee it does not have.

### Empty window (AC11)

An empty window is a successful read: `bars: []`, `bar_count: 0`, studies
present with empty output arrays, full provenance. Not an error — a market
holiday is a fact about the market, not a failure of the call.

### Tests

`chartData.test.ts` and `getChartData.test.ts`, driven by
`createInMemoryChartSeries` and a small fake repository, one described case
per acceptance criterion plus the key-scan test for AC6 and a `put`-call
counter for AC10.

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
