# T-1016-1: Vectorized panel I/O — remove row objects from the bulk path

**Epic**: EPIC-1016 (Market Data Storage)
**Status**: Open
**Depends on**: —
**Blocks**: T-1016-2, T-1016-3
**Issue**: #13
**Design**: docs/design/market-data-storage/

## Description

`panel_io.parquet_bytes_to_bars()` ends with
`[PriceBar(**row) for row in frame[PANEL_COLUMNS].to_dict("records")]`, and
`bars_to_parquet_bytes()` does the mirror image. Measured at 1,081 bytes/row,
that transient list peaks at ~13 GB on a 12M-row panel — the single reason
the backend cannot boot on real data at any instance size.

Move the bulk path to Parquet <-> compact frame directly. The schema gate
becomes column-level (presence, dtype, ordering) instead of per-row Pydantic.
`PriceBar` is unchanged and keeps its role at the single-bar boundary, where
per-row validation earns its cost.

## User Story

As an operator deploying the backend with real market data,
I want the panel to load without materializing every row as an object,
so that the service starts within its memory budget instead of being killed.

## Acceptance Criteria

1. Loading a panel of N rows costs memory proportional to the compact
   representation, with no transient allocation proportional to N row
   objects. Demonstrated by measurement, not inspection.
2. A panel written by the mock generator and one written by the real
   pipeline both load through this path to byte-identical compact frames.
3. A panel with a missing column, a wrong dtype, or reordered columns fails
   the load with an error naming the offending column — the drift is caught
   at the boundary, not in the engine.
4. `PriceBar` and its use at the single-bar boundary are unchanged.
5. The engine's public behavior is unchanged: every pre-existing test passes
   without modification.

## Out of Scope

Partitioning (T-1016-3); streaming evaluation (T-1016-4).
