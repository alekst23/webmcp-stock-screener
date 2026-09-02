# T-1006-3: Market-data provenance contract

**Epic**: EPIC-1006 (Workspace, Revisions & the Common Tool Contract)
**Design**: docs/design/workspace-revisions/
**Status**: Open
**Depends on**: —
**Blocks**: T-1006-8

## Description

The design doc requires that market-data results always state their as-of
time, source, live/delayed status, timezone, currency, price-adjustment
basis, fundamentals reporting period and calculation-engine version. This
ticket defines that record, the wrapper that attaches it to any payload,
and the port through which the separate reference/fundamental-data
workstream will supply it. Without this, an agent can quote a delayed,
unadjusted, foreign-currency price as though it were current.

## User Story

As a human reading a number an agent just told me,
I want to know when it was true, where it came from, whether it is delayed
and whether it is adjusted,
so that I do not act on a stale or incomparable figure.

## Acceptance Criteria

1. A provenance record states the as-of instant, the source, the liveness
   of the data, the timezone, the currency, the price-adjustment basis and
   the calculation-engine version.
2. Liveness distinguishes live, delayed, end-of-day and historical data.
3. When data is delayed, the delay is stated as a duration; when it is not
   delayed, no misleading duration is present.
4. Price adjustment distinguishes adjusted, unadjusted, and not-applicable
   — the last for results where no price is involved.
5. A fundamentals reporting period, when present, states the fiscal year,
   the fiscal period, the period end date and whether the figures are
   restated; it is explicitly absent for results carrying no fundamentals.
6. Any payload can be wrapped so it carries its data and its provenance
   together, without the payload type being constrained.
7. A provenance record serializes to snake_case field names consistent
   with the rest of the agent-facing contract.
8. A port exists through which a data provider supplies the current
   provenance for prices, fundamentals or reference data, and this ticket
   ships no provider implementing it beyond what tests need.

## Design References

- `docs/reference/tool-spec.md` — the final paragraph of "Common contract for
  every tool" enumerates every field required here.
- `docs/design/workspace-revisions/technical.md` — "T-1006-3" section.
- `docs/reference/data-provider.md` — the existing provider notes, for the
  vocabulary the separate data workstream is likely to use.

## Solution Approach

`provenance.ts` defines `MarketDataProvenance` with every field the design
doc names non-optional except `delaySeconds` (`number | null`, non-null
only when `liveness === 'delayed'`) and `fundamentalsPeriod` (`{...} | null`,
present only for results carrying fundamentals) — encoding AC3/AC5's
presence rules in the type itself rather than in a comment. `withProvenance`
is a generic one-liner wrapper (`{ data, provenance }`); `toWireProvenance`
snake_cases the record's own keys the same way T-1006-2's
`toWireEnvelope` does, including the nested `fundamentalsPeriod` object.

The `ProvenanceSource` port goes in `domain/ports.ts` alongside T-1006-4's
repository port (same file, both are domain ports with no implementation
here). No adapter ships in this ticket; tests use a fixed in-file fake
(e.g. `{ current: () => FIXED_PROVENANCE }`) purely to exercise
`withProvenance`/`toWireProvenance`, not to model a real provider.

**Contracts introduced:** `MarketDataProvenance`, `WithProvenance<T>`,
`withProvenance`, `toWireProvenance`, `ProvenanceSource` —
`src/lib/workbench/domain/provenance.ts` (port in `.../domain/ports.ts`).

## Technical Considerations

- Modules: `src/lib/workbench/domain/provenance.ts`, with the port added to
  `src/lib/workbench/domain/ports.ts`. Pure domain — the port is declared
  here, implemented elsewhere, and domain must not import from `infra/`.
- Exported contract surface other epics depend on:
  `MarketDataProvenance`, `WithProvenance<T>`, `withProvenance`,
  `toWireProvenance`, `ProvenanceSource`.
- Deliberately **do not** build a mock data pipeline. Reference and
  fundamental market data is a separate parallel workstream; this ticket
  must not block on it and must not pre-empt it. A trivial fixed-value
  source in the test file is the limit.
- Currency is ISO 4217, timezone is an IANA name — state both as such so
  sibling epics do not invent their own encodings.
- Every field the design doc names must be non-optional in the type unless
  the design explicitly allows absence (delay, fundamentals period), so a
  provider cannot quietly omit one.

## Out of Scope

Fetching data, caching it, or deciding which provider is used — the
separate data workstream owns all of that. Also out of scope: attaching
provenance to specific tool results, which each owning epic does.
