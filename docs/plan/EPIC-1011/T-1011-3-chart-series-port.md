# T-1011-3: Chart series port and market-data provenance envelope

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Open
**Depends on**: —
**Blocks**: T-1011-4, T-1011-6, T-1011-9

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
- `.dev/design/tool-spec.md` — "Market-data results should always state
  `as_of`, source, live/delayed status, timezone, currency,
  adjusted/unadjusted prices, fundamentals reporting period, and
  calculation-engine version"
- `src/lib/workspace/apiEngine.ts` — the existing backend price-bar
  request pattern and bar shape to mirror in the new adapter
- `docs/reference/data-provider.md` — what the current data provider
  supplies and with what delay

## Technical Considerations

- EPIC-1006 owns the provenance *type*. This ticket populates it; it
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
