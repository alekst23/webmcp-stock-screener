# EPIC-1016: Market Data Storage

**Depends on**: T-1001-9 (real data pipeline — `feat/T-1001-9-real-data-pipeline`,
commit `8448059`, unmerged) — supplies the compact `PanelFrame`, R2 object
store, and `PanelStatus` this epic builds on
**Blocks**: T-1001-9's AC1 real backfill and AC5 spot-check
**Design**: docs/design/market-data-storage/
**Issue**: #13

> **Epic number deviates from the derivation rule.** Issue #13 derives
> `EPIC-1013`, which was already taken by "Safety layer (preview & apply)"
> from the ten-epic Wave 0 batch. Renumbered to the next free number.

## Description

The backend cannot boot against real market data. `panel_io.py` round-trips
every panel row through a Pydantic `PriceBar` on both read and write —
measured at 1,081 bytes/row, so the real universe's ~12M ticker-days peak
at ~13 GB on every startup. That is unaffordable on any Render tier,
including a 2 GB Standard instance. `merge_bars` compounds it, building a
whole-panel `(ticker, date)` dict on every nightly delta to append one day.

T-1001-9 already fixed steady-state residency (141 -> 25.1 bytes/row) but
left the I/O boundary in front of it row-object-based, so peak load was
never addressed.

Fixing only that would leave a second problem: 25.1 bytes/row is still
linear in universe x history, and panel size is a product input. This epic
therefore takes storage to where memory is bounded by the *query* rather
than the dataset — the full US listed universe (~6,268 tickers, 10+ years,
~12M rows) served from a 512 MB free-tier instance, with room to grow.

The engine's public surface, `PriceBar`, and every existing test stay
unchanged throughout. Each ticket is independently shippable.

## Target

~6,268 tickers x 10+ years (~12M ticker-days) on 512 MB. Memory bounded by
query working set, not panel size.

## Tickets

| Ticket | Title | Depends on |
|--------|-------|-----------|
| T-1016-1 | Vectorized panel I/O — remove row objects from the bulk path | — |
| T-1016-2 | Delta-proportional, idempotent panel append | T-1016-1 |
| T-1016-3 | Ticker-partitioned Parquet with pruning and projection | T-1016-1 |
| T-1016-4 | Streaming universe evaluation — bounded peak residency | T-1016-2, T-1016-3 |
| T-1016-5 | Disclose panel staleness and partial coverage | T-1016-3 |
| T-1016-6 | Verify at full universe scale on 512 MB | T-1016-4, T-1016-5 |

Ordering is forced: until row objects leave the bulk path (T-1016-1) their
transient peak dominates every measurement, so partitioning and streaming
cannot be evaluated meaningfully before it lands.

## Out of Scope

Intraday bars; fundamentals; DuckDB-over-R2 (considered and deferred — see
`docs/design/market-data-storage/technical.md`); multi-region replication.
