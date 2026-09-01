# T-1016-1: Vectorized panel I/O — remove row objects from the bulk path

**Epic**: EPIC-1016 (Market Data Storage)
**Status**: Complete
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

## Implementation Plan

1. `infra/panel_io.parquet_bytes_to_panel()` — Parquet bytes straight to the
   compact frame. Compact columns are allocated once at their final size and
   filled from `ParquetFile.iter_batches()`, so nothing panel-sized is ever
   held twice.
2. `validate_wire_schema()` — the column-level gate (presence, order, arrow
   type family), raising the new `domain.errors.PanelSchemaError` naming the
   offending column.
3. `bars_to_table()` — the write path built column-wise, replacing
   `DataFrame([bar.model_dump() ...])` and its dict per row.
4. `application/load_panel.py` returns a `PanelFrame` instead of
   `list[PriceBar]`; `main.py` constructs the engine from it directly.
   `PandasPatternResearchEngine.from_price_bars` is untouched and still
   serves every existing test.
5. `scripts/measure_panel_memory.py` — the measurement harness, kept as a
   runnable script so the numbers below can be reproduced (and so T-1016-6
   has an instrument).

Three details each cost a full extra copy of the panel and were only found
by measuring:

* `io.BytesIO(data)` copies the bytes it wraps — `pa.py_buffer` does not.
* Whole-column reads do not release to the OS between columns, so the seven
  column peaks add rather than overlap; batched reads bound the transient.
* `pd.DataFrame(dict)` consolidates same-dtype columns into one block, which
  rebuilds the entire frame. `copy=False` over `pd.Series(..., copy=False)`
  keeps the arrays that were just filled.

## Measurements (AC1)

Peak RSS of a fresh process, panel bytes already resident, via
`scripts/measure_panel_memory.py` (Darwin, CPython 3.10.16, pyarrow 25.0.1).
`frame` is the new bulk path, `bars` the row-object path it replaces:

| rows | frame peak | frame B/row | bars peak | bars B/row |
|---|---|---|---|---|
| 120k | 27.6 MB | 230 | 245.6 MB | 2,047 |
| 1.2M | 96.5 MB | 80 | 1,930.6 MB | 1,609 |
| 3.0M | 162.8 MB | 54 | not run | — |

Per-row figures fall with panel size because ~20 MB of the total is the
interpreter's fixed footprint, so the honest number is the marginal cost:
**~63 bytes/row** for the bulk path against **~1,560 bytes/row** for the
row-object path — a 25x reduction, and the reason the ~5M-row target
universe now lands around 300 MB peak instead of ~8 GB.

`tests/performance/test_panel_load_memory.py` re-measures both paths and
fails on the slope, not on a remembered number.

## Verification

- `tests/unit/test_panel_io.py` — AC2 (both producers load to identical
  compact frames), AC3 (missing / wrong-dtype / reordered columns each name
  the offending column), plus category ordering and dtype conformance.
- `tests/performance/test_panel_load_memory.py` — AC1.
- AC4/AC5: `PriceBar` and `from_price_bars` unchanged; the pre-existing
  suite passes unmodified (60 passed, 5 skipped).

Each new test was mutation-checked: reverting the reader to the row-object
path fails both performance tests; removing the type gate, the order gate,
the category remap, or the float32 narrowing each fails exactly the test
that targets it.
