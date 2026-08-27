# T-1001-9: Real data pipeline (paid, deferred)

**Epic**: EPIC-1001 (WebMCP Pattern Research Workbench)
**Status**: Open
**Depends on**: T-1001-1, T-1001-8
**Blocks**: T-1001-10
**Issue**: #1

## Description

With the design proven end-to-end against mock data, this ticket replaces
the mock dataset with real historical market data for the full target
universe of stocks, and establishes the ongoing process that keeps it
current. This is the first ticket in the project that incurs a real,
ongoing cost — it is deliberately sequenced as late as the dependency
graph allows.

## User Story

As a user (or their AI agent) researching a pattern,
I want the app to reflect real historical stock data across the full
target universe, kept reasonably current,
so that findings are meaningful rather than illustrative.

## Acceptance Criteria

1. Historical daily price data for the full intended universe of stocks,
   covering the intended history length, is loaded and available to the
   engine, replacing the mock dataset without requiring changes to the
   engine, tools, or frontend built in prior tickets.
2. An automated process keeps the dataset current by regularly adding the
   latest trading day's data without manual intervention.
3. Per-stock classification data (at minimum sector and a size bucket)
   needed for universe filtering is available and reasonably current.
4. The data's as-of date is visible somewhere a user would see it, so
   results are never presented as more current than they actually are.
5. A full example research session produces plausible, sane results
   against the real data, spot-checked against a small number of
   independently known real-world facts (e.g., a known historical earnings
   gap in a well-known stock).
6. This ticket is not started until the tickets it depends on are complete
   and verified.

## Design References

- `docs/reference/data-provider.md` — source, endpoints, cost, volume
- `docs/plan.md` — deferred-payment sequencing decision, survivorship-bias
  disclosure requirement

## Technical Considerations

This is the paid step (~$20/month). Confirm explicit go-ahead before
incurring the cost if it has not already been given.

## Out of Scope

Historical fundamentals data; intraday data.
