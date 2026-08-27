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

## Solution Approach

Replaces T-1001-1's mock `panel.parquet` with a real one built the same
way — same `PriceBar` schema (T-1001-1/T-1001-3), so nothing downstream
changes. Backfill uses EODHD's per-ticker range endpoint (1 API call per
ticker, any date length — confirmed in `data-provider.md`, not the
bulk-by-day endpoint, which is for the nightly delta only). Nightly delta
via the bulk-by-exchange endpoint as a Render Cron Job, appending to the
same disk T-1001-8's Web Service reads. Sector/market-cap metadata comes
from a free Nasdaq screener CSV export, not EODHD (outside its plan).
As-of date surfaces through a small addition to `getWorkspace`'s response
(or an adjacent endpoint) so the UI can display it per spec.md's
Preconditions.

**Contracts introduced:** `TickerMetadata` →
`backend/domain/models/universe.py` — `ticker`, `sector`, `market_cap`,
`as_of`.

**Config vars introduced:** none new — reuses `EODHD_API_KEY` from
T-1001-1, but the underlying EODHD account must be upgraded to the paid
EOD Historical Data plan ($19.99/mo) for this ticket; the free tier used
in T-1001-1 is insufficient for full-universe/full-history backfill. This
is an account-tier change, not a different key.

## Technical Considerations

This is the paid step (~$20/month). Confirm explicit go-ahead before
incurring the cost if it has not already been given.

## Out of Scope

Historical fundamentals data; intraday data.
