# T-1016-3: Ticker-partitioned Parquet with pruning and projection

**Epic**: EPIC-1016 (Market Data Storage)
**Status**: Complete
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

## Implementation Plan

`infra/panel_query.py`:

* `panel_read_plan(data, tickers, columns) -> PanelReadPlan` — which row
  groups and which column chunks a read would touch, and how many compressed
  bytes that is, read off the file's own metadata before anything is decoded.
  A value rather than a log line, so the pruning claim is something tests can
  assert on and a future range-reading store can act on.
* `parquet_bytes_to_subset(data, tickers, columns)` — the read itself. Row
  groups whose ticker min/max cannot contain a requested ticker are skipped;
  within a group, each ticker's rows are one contiguous run, so two binary
  searches per ticker select them with no per-row membership test.

`panel_io.PANEL_ROW_GROUP_ROWS` is now the single sizing constant, used by the
backfill writer, the nightly append, and tests alike -- a panel that is
written differently prunes differently, and that would be an invisible
regression.

The engine is untouched (AC4). This is a capability the loader and T-1016-5's
partial-coverage disclosure build on, not a change to how the panel is read
today.

## Row-group sizing (AC5)

**Read pattern assumed:** whole-history reads of a named ticker subset, from a
panel sorted by ticker. Ten years of daily bars is ~2,520 rows per ticker.

**Chosen: 25,000 rows**, about ten tickers' full history per group.

Measured on a 3M-row / 2,400-ticker panel, file size is insensitive across the
plausible range -- 118.9 MB at 10k rows/group, 118.6 MB at 25k, 118.9 MB at
50k, 119.4 MB at 100k -- so the choice costs nothing in storage and is decided
entirely by pruning granularity and by how much a reader must hold at once.
Smaller groups prune better; 25k keeps footer metadata at 95 KB (0.08% of the
file) and a group's decoded wire data at roughly 1 MB.

## Measurements (AC1, AC2)

Fraction of the panel's compressed bytes a read touches, 3M rows / 2,400
tickers / 120 row groups:

| read | row groups | fraction read |
|---|---|---|
| whole panel | 120 | 1.000 |
| 1 ticker | 1 | 0.009 |
| 100 adjacent tickers | 5 | 0.043 |
| 500 adjacent tickers | 25 | 0.214 |
| 1,200 adjacent tickers (half the universe) | 60 | 0.513 |
| `close` column only | 120 | 0.244 |
| ticker + date + close | 120 | 0.269 |
| 1 ticker, `close` only | 1 | 0.002 |

**Where pruning does not help, stated plainly.** Row-group skipping is a
function of *adjacency*, not of count. A universe of 100 tickers scattered
evenly across the alphabet touches 100 of 120 groups and reads 83%; 480
scattered tickers read 100%. Column projection is unconditional -- it pays
whatever the filter looks like -- but ticker pruning pays for narrow or
contiguous selections (a single ticker's history, a sector-sorted slice), not
for a thin sample of the whole universe. Sorting the panel by something a
filter is actually contiguous in would change that, and is not free; it is
recorded here so a later change has something to argue with.

## Verification

- `tests/unit/test_panel_query.py` — AC1 (a two-ticker filter reads one row
  group and under 25% of the panel), AC2 (unnamed columns are not read; the
  ticker column is read to filter but returned only if asked for), AC3 (an
  absent ticker reads nothing and returns an empty frame), AC5 (the writer's
  row-group count), plus equality with the whole panel filtered, which is what
  makes the layout transparent (AC4).
- AC4 also: the pre-existing suite passes unchanged.

Mutation-checked: disabling row-group pruning fails both pruning tests;
disabling column projection fails both projection tests; encoding the ticker
categories before filtering instead of after fails the equality test.
