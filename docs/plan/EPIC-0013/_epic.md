# EPIC-0013: Market Data Storage

**Depends on**: T-0015-9 (real data pipeline — `feat/T-0015-9-real-data-pipeline`,
commit `8448059`, unmerged) — supplies the compact `PanelFrame`, R2 object
store, and `PanelStatus` this epic builds on
**Blocks**: T-0015-9's AC1 real backfill and AC5 spot-check
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

T-0015-9 already fixed steady-state residency (141 -> 25.1 bytes/row) but
left the I/O boundary in front of it row-object-based, so peak load was
never addressed.

Fixing only that leaves a second problem worth naming: cost that grows
*faster* than the data. This epic removes that class of fault — no per-row
objects, no index larger than what it indexes, no whole-panel work to append
one day — and partitions the panel so a filtered universe actually costs
less.

It stops deliberately short of decoupling memory from dataset size. This is
a POC: the panel stays fully resident over a trimmed liquid universe, on the
explicit understanding that production needs a real store. A hand-rolled
chunked scanner would be a query engine built to be discarded exactly when
it starts mattering; DuckDB-over-R2 is the designated next rung, reading the
same partitioned Parquet this epic produces.

The engine's public surface, `PriceBar`, and every existing test stay
unchanged throughout. Each ticket is independently shippable.

## Target

A trimmed liquid universe — on the order of 2,000 US listed common stocks
across 10+ years (~5M ticker-days, ~130 MB resident) — on 512 MB with real
headroom. Sized deliberately, not by accident. The liquidity floor also
improves the research: microcaps distort pattern base rates.

## Tickets

| Ticket | Title | Depends on |
|--------|-------|-----------|
| T-0013-1 | Vectorized panel I/O — remove row objects from the bulk path | — |
| T-0013-2 | Delta-proportional, idempotent panel append | T-0013-1 |
| T-0013-3 | Ticker-partitioned Parquet with pruning and projection | T-0013-1 |
| T-0013-5 | Disclose panel staleness and partial coverage | T-0013-3 |
| T-0013-6 | Verify at target universe scale on 512 MB | T-0013-3, T-0013-5 |

T-0013-4 (streaming universe evaluation) is **deferred, not scheduled** —
see its ticket file for why, and `technical.md` for the upgrade ladder it
sits outside of.

Ordering is forced: until row objects leave the bulk path (T-0013-1) their
transient peak dominates every measurement, so partitioning cannot be
evaluated meaningfully before it lands.

## Out of Scope

Intraday bars; fundamentals; multi-region replication. Streaming/chunked
evaluation (T-0013-4, deferred) and DuckDB-over-R2 — both are the documented
upgrade path, not this epic's scope. See
`docs/design/market-data-storage/technical.md`.
