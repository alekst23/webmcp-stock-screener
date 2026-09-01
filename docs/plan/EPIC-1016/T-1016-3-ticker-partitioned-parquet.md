# T-1016-3: Ticker-partitioned Parquet with pruning and projection

**Epic**: EPIC-1016 (Market Data Storage)
**Status**: Open
**Depends on**: T-1016-1
**Blocks**: T-1016-4, T-1016-5
**Issue**: #13
**Design**: docs/design/market-data-storage/

## Description

Make the panel addressable by ticker so a query reads only what it needs.
Parquet already supplies the index — per-row-group min/max statistics plus
column projection — provided the panel is written sorted by ticker with a
row-group size tuned to the read pattern. Use the format's own machinery
rather than maintaining a parallel index that could drift from it.

## User Story

As a researcher searching a filtered universe,
I want the query to read only the tickers and fields it actually uses,
so that excluding most of the universe actually costs less.

## Acceptance Criteria

1. The panel is written partitioned and sorted such that reading a named
   subset of tickers reads substantially less than the whole panel.
   Demonstrated by measured bytes or row-groups read, not by inspection.
2. Reading a named subset of columns does not read the unnamed ones.
3. A read for a ticker absent from the panel returns empty without reading
   unrelated partitions and without error.
4. A partition layout change is transparent to the engine — its public
   behavior and every existing test are unchanged.
5. Row-group sizing is chosen against a stated read pattern and the
   reasoning is recorded, so a later change has something to argue with.

## Out of Scope

Streaming evaluation over the partitions (T-1016-4).
