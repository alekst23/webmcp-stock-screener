# T-1011-3: Chart series port and market-data provenance envelope

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Open
**Depends on**: —
**Blocks**: T-1011-4, T-1011-6, T-1011-9

## Solution Approach

### Shape of the work

Three new files plus their tests, all under `src/lib/workbench/chart/`:

| File                                 | Layer  | Contents                                                                                                                            |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `chart/domain/seriesPort.ts`         | domain | `ChartSeriesPort`, `OhlcvBar`, request/result types, `ChartSeriesError`, the pure window and provenance helpers both adapters share |
| `chart/infra/httpChartSeries.ts`     | infra  | adapter over the existing backend price API                                                                                         |
| `chart/infra/inMemoryChartSeries.ts` | infra  | deterministic fixture implementation for tests and for the composition root before a real feed exists                               |

The domain file imports only from `src/lib/workbench/domain/` (`provenance.ts`,
`ports.ts`, `errors.ts`). Nothing in the domain layer imports infra.

### Boundedness enforced in the type (AC7)

`ChartSeriesRequest.window` is a required `{ start, end }` of two required ISO
strings. There is no optional window, no `'all'`/`'max'` token, and no
`lastNBars` or cursor alternative — so "fetch everything" is not a value the
request type can hold. A caller that omits the window does not compile. The
runtime check (`start <= end`, both parseable) is a second line of defence for
untyped call sites, not the guarantee itself. There is deliberately no
pagination affordance in the result: no `nextCursor`, no `hasMore`.

### Requested versus applied price adjustment (AC4)

`ChartPriceAdjustment = 'adjusted' | 'split_adjusted' | 'unadjusted'` is defined
locally here; a later ticket reconciles it with T-1011-1's identical definition
by re-export. The result carries both `requestedPriceAdjustment` and
`appliedPriceAdjustment`; when they differ the result carries a warning naming
both, and provenance always reports what was applied.

The basis is never guessed. Each adapter is configured with the basis its source
is _documented_ to deliver — a required field with no default — and can be told
`'unreported'` when the source genuinely does not state one. `'unreported'`
yields `appliedPriceAdjustment: null`, an omitted `priceAdjustment` in
provenance (the contract makes it genuinely optional), and an explicit warning,
rather than a fabricated basis.

The chart enum is coarser than `MarketDataProvenance.priceAdjustment`
(`adjusted | unadjusted | not_applicable`). Documented mapping:
`adjusted -> adjusted`, `unadjusted -> unadjusted`,
`split_adjusted -> adjusted` (split-adjusted prices are adjusted, just not for
distributions; the exact chart policy is always echoed in
`appliedPriceAdjustment` so nothing is lost).

### Provenance assembly (AC3)

Every record is built through `makeProvenance()` from
`src/lib/workbench/domain/provenance.ts` — never an object literal — so
`engineVersion` is stamped from the single `ENGINE_VERSION` constant rather than
injected or hard-coded. Liveness is supplied as a discriminated
`ChartSeriesLiveness`, so a `'delayed'` source cannot be configured without a
`delaySeconds` magnitude and a non-delayed one cannot carry a stale delay
figure. `asOf` is the instant the source was read (from the injected `Clock`),
because the panel's date-only bars cannot yield an ISO instant with an offset
without inventing one; the data's own currency is carried by `liveness`, which
is `'historical'` for the HTTP adapter's bar reads and `'static'` for the
in-memory fixture. `currency`, `timezone` and `reportingPeriod` are declared by
the adapter's configuration; `reportingPeriod` is passed through only when a
caller supplies one and omitted otherwise, per the "do not build a fundamentals
pipeline" constraint.

### HTTP adapter against the existing backend

The only bar-bearing backend route is `POST /api/research/instance-windows`
(`backend/api/routes/research.py`), which returns `PriceBar` rows for sampled
instances. `apiEngine.ts`'s `showTickerCharts` already establishes the technique
of synthesizing an instance set to get bars for a ticker; the adapter duplicates
that technique rather than importing or modifying `apiEngine.ts`.

The adapter posts one synthetic instance per calendar day in the requested
window with a bar offset window of `[0, 0]`, so the backend returns exactly the
bars that exist inside the window and nothing outside it — no bar-count
heuristic, no anchor that has to land on a trading day, and no way for the
request to reach past the window. The returned windows are flattened,
deduplicated by date and sorted ascending.

Because the stored panel is a daily, regular-session, adjusted-basis panel:

- the instrument ID is mapped to the backend's ticker through an injected
  `resolveSymbol` — the port itself never accepts a bare ticker;
- timeframes the source cannot serve raise `ChartSeriesError` with reason
  `unsupported_timeframe` (configurable set, default `['1d']`);
- a session the source cannot serve is echoed back with a warning rather than
  an error, since the bars are still the caller's regular-session bars.

### Typed failures (AC6)

`ChartSeriesError extends Error` with a `reason`
(`invalid_window | unknown_instrument | unsupported_timeframe | source_unavailable |
malformed_response`), an optional `instrumentId`, a `toWireError()` matching the
`WireError` convention in `workbench/domain/errors.ts`, and the underlying
transport failure attached as `cause`. No raw `fetch` rejection, non-OK
response, or JSON parse failure escapes the adapter untyped.

### Empty windows (AC5)

An in-range window with no bars — a holiday, a delisted name, a gap — returns
`bars: []` with fully valid provenance. Only a malformed window (`end` before
`start`, unparseable dates) is an error, and that is a caller mistake rather
than an absence of data.

### Tests

- `seriesPort.test.ts` — window validation, the adjustment mapping, warning
  text, provenance assembly invariants, `ChartSeriesError` cause and wire shape.
- `httpChartSeries.test.ts` — stubbed `fetch`: request body is window-bounded,
  bars are mapped and filtered, non-OK responses and thrown transports become
  `ChartSeriesError` with the cause preserved, empty responses yield an empty
  series, unknown instrument and unsupported timeframe never touch the network.
- `inMemoryChartSeries.test.ts` — the port contract exercised through a real
  in-memory implementation: happy path, delayed-source provenance,
  adjustment downgrade, unreported basis, empty window, source failure.

## Description

The chart tools need bars, and every payload derived from those bars has
to state where they came from and how they were adjusted. This ticket
defines the narrow domain port the chart reads bars through, an adapter
that satisfies it from the existing backend price API, and the assembly
of the market-data provenance block the spec requires on every result.

## User Story

As a researcher acting on what an agent read off a chart,
I want every number to arrive stamped with its as-of time, source,
delay status, timezone, currency, and adjustment policy,
so that I can tell stale, delayed, or unadjusted data from the real thing
before I trade on it.

## Acceptance Criteria

1. A port exists for requesting a bounded bar series for one instrument
   ID at one timeframe, over one explicit window, under one
   price-adjustment policy and one session, and it returns bars plus a
   provenance block.
2. The port's contract is declared in the domain layer and its
   implementation lives in the infrastructure layer; the domain layer
   contains no import from the infrastructure layer.
3. The provenance block states `as_of`, source, live-or-delayed status
   (with the delay when delayed), timezone, currency, the effective
   price-adjustment policy, the calculation-engine version, and the
   fundamentals reporting period when fundamentals contributed to the
   result.
4. The provenance block reports the price-adjustment policy actually
   applied, which may differ from the one requested when the source
   cannot honour it; when it differs, the result carries a warning
   naming both.
5. A request for a window with no data available returns an empty series
   with valid provenance rather than an error.
6. A source failure surfaces as a typed, chart-layer error carrying the
   underlying cause, not a raw transport exception.
7. The adapter never issues a request without an explicit window bound;
   an unbounded request is impossible to express through the port.
8. The port is exercised in tests through a fake implementation with real
   behavior — including the delayed-data, adjustment-downgrade,
   empty-window, and source-failure cases — with no network access.

## Design References

- `docs/design/chart-tools/spec.md` — "Read a bounded slice of the
  chart", provenance scenarios
- `docs/design/chart-tools/technical.md` — provenance envelope fields
- `docs/reference/tool-spec.md` — "Market-data results should always state
  `as_of`, source, live/delayed status, timezone, currency,
  adjusted/unadjusted prices, fundamentals reporting period, and
  calculation-engine version"
- `src/lib/workspace/apiEngine.ts` — the existing backend price-bar
  request pattern and bar shape to mirror in the new adapter
- `docs/reference/data-provider.md` — what the current data provider
  supplies and with what delay

## Technical Considerations

- EPIC-1006 owns the provenance _type_. This ticket populates it; it
  should not define a competing one. If EPIC-1006 has not landed, declare
  the minimal shape and mark it for replacement in T-1011-9.
- Reference and fundamental data are being wired up in a separate
  parallel workstream and reach the chart through EPIC-1008's ports. Do
  not build a mock pipeline for them and do not block on them — the
  fundamentals reporting period is passed through when present and
  omitted when not.
- AC7 is the first half of the epic's boundedness guarantee: if the port
  cannot express "everything", no caller can accidentally request it.
- Do not modify `apiEngine.ts` or any existing module; read it for its
  request/response conventions and write new files.

## Out of Scope

- The per-call bar cap and the agent-facing refusal message (T-1011-6).
- Study computation (T-1011-2).
- Caching or prefetch strategy.
- Building or changing the backend data pipeline.
