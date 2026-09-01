"""Reading part of the panel: fewer tickers, fewer columns, less decoded.

Parquet already is the index. The panel is written sorted by ticker with a
fixed row-group size (`panel_io.PANEL_ROW_GROUP_ROWS`), so every row group
carries min/max ticker statistics that say whether it can possibly hold a
requested ticker, and every column is a separate chunk that can be skipped
outright. A hand-rolled ticker index would duplicate both and then have to be
kept consistent with them.

What this does *not* do is fetch less over the network: `PanelStore` hands
back whole objects. Pruning here is about what gets decoded and held, which
is the term that dominates memory. Range requests are the next rung, and the
plan below is what would drive them.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from infra.panel_io import (
    EPOCH_ORDINAL,
    PANEL_COLUMNS,
    batch_codes,
    categorical,
    validate_wire_schema,
)

_COMPACT_DTYPES = {
    "date": np.int32,
    "open": np.float32,
    "high": np.float32,
    "low": np.float32,
    "close": np.float32,
    "volume": np.uint32,
}


@dataclass(frozen=True)
class PanelReadPlan:
    """What a filtered read will actually decode, before it decodes it.

    Kept as a value rather than a log line so the pruning claim is a thing
    tests can assert on and a future range-reading store can act on.
    """

    row_groups: list[int]
    columns: list[str]
    compressed_bytes: int
    total_compressed_bytes: int

    @property
    def fraction_read(self) -> float:
        if not self.total_compressed_bytes:
            return 0.0
        return self.compressed_bytes / self.total_compressed_bytes


def panel_read_plan(
    data: bytes, tickers: list[str] | None = None, columns: list[str] | None = None
) -> PanelReadPlan:
    """The plan alone, for measurement and for callers deciding whether a
    filtered read is worth issuing."""
    reader = pq.ParquetFile(pa.BufferReader(pa.py_buffer(data)))
    validate_wire_schema(reader.schema_arrow)
    return _plan(reader, tickers, columns)


def parquet_bytes_to_subset(
    data: bytes, tickers: list[str] | None = None, columns: list[str] | None = None
) -> pd.DataFrame:
    """A compact frame holding only the named tickers and columns.

    `tickers=None` means every ticker, `columns=None` every column. A ticker
    with no rows in the panel simply contributes none -- an empty universe is
    a legitimate answer to a narrow filter, not an error.
    """
    reader = pq.ParquetFile(pa.BufferReader(pa.py_buffer(data)))
    validate_wire_schema(reader.schema_arrow)
    plan = _plan(reader, tickers, columns)
    wanted = np.array(sorted(set(tickers)), dtype=object) if tickers is not None else None
    output = list(columns) if columns is not None else list(PANEL_COLUMNS)
    parts: list[dict[str, np.ndarray]] = []
    catalog: dict[str, int] = {}
    for group in plan.row_groups:
        table = reader.read_row_group(group, columns=plan.columns)
        parts.append(_compact_group(table, wanted, output, catalog))
    return _frame(parts, output, catalog)


@dataclass(frozen=True)
class ResilientRead:
    """A panel read that survived what it could, and says what it lost."""

    frame: pd.DataFrame
    missing: list[str]


def read_panel_resilient(data: bytes) -> ResilientRead:
    """Read the panel row group by row group, skipping the ones that fail.

    The degraded path, not the normal one: `panel_io.parquet_bytes_to_panel`
    fills preallocated columns and is what runs when the file is intact. This
    one concatenates, which costs a second copy at the end -- worth paying
    only when the alternative is serving nothing at all.

    A skipped group is named by its ticker range, which lives in the footer
    and so survives corruption of the data pages it describes.
    """
    reader = pq.ParquetFile(pa.BufferReader(pa.py_buffer(data)))
    validate_wire_schema(reader.schema_arrow)
    parts: list[dict[str, np.ndarray]] = []
    missing: list[str] = []
    catalog: dict[str, int] = {}
    for group in range(reader.metadata.num_row_groups):
        try:
            table = reader.read_row_group(group, columns=PANEL_COLUMNS)
        except (pa.ArrowException, OSError, ValueError):
            missing.append(_group_range(reader.metadata.row_group(group)))
            continue
        parts.append(_compact_group(table, None, PANEL_COLUMNS, catalog))
    return ResilientRead(_frame(parts, list(PANEL_COLUMNS), catalog), missing)


def _group_range(group: pq.RowGroupMetaData) -> str:
    statistics = group.column(PANEL_COLUMNS.index("ticker")).statistics
    if statistics is None or statistics.min is None or statistics.max is None:
        return "unknown tickers"
    return f"{statistics.min}..{statistics.max}"


def _plan(
    reader: pq.ParquetFile, tickers: list[str] | None, columns: list[str] | None
) -> PanelReadPlan:
    read_columns = _read_columns(columns, tickers is not None)
    metadata = reader.metadata
    indices = [reader.schema_arrow.get_field_index(name) for name in read_columns]
    groups = [
        group
        for group in range(metadata.num_row_groups)
        if _group_may_hold(metadata.row_group(group), tickers)
    ]
    compressed = sum(
        metadata.row_group(group).column(index).total_compressed_size
        for group in groups
        for index in indices
    )
    total = sum(
        metadata.row_group(group).column(index).total_compressed_size
        for group in range(metadata.num_row_groups)
        for index in range(metadata.num_columns)
    )
    return PanelReadPlan(groups, read_columns, compressed, total)


def _read_columns(columns: list[str] | None, filtering: bool) -> list[str]:
    """Columns to decode: the ones asked for, plus ticker when it is needed to
    apply the filter rather than to answer with."""
    requested = set(columns) if columns is not None else set(PANEL_COLUMNS)
    unknown = requested - set(PANEL_COLUMNS)
    if unknown:
        raise ValueError(f"Unknown panel columns {sorted(unknown)}: have {PANEL_COLUMNS}")
    if filtering:
        requested.add("ticker")
    return [name for name in PANEL_COLUMNS if name in requested]


def _group_may_hold(group: pq.RowGroupMetaData, tickers: list[str] | None) -> bool:
    """Whether a row group's ticker range overlaps the requested set.

    Statistics can legitimately be absent (a producer that disabled them), and
    the safe answer then is to read the group: pruning may only ever skip what
    it can prove is irrelevant.
    """
    if tickers is None:
        return True
    statistics = group.column(PANEL_COLUMNS.index("ticker")).statistics
    if statistics is None or statistics.min is None or statistics.max is None:
        return True
    return any(statistics.min <= ticker <= statistics.max for ticker in tickers)


def _compact_group(
    table: pa.Table, wanted: np.ndarray | None, output: list[str], catalog: dict[str, int]
) -> dict[str, np.ndarray]:
    symbols = (
        np.asarray(table.column("ticker").to_numpy(zero_copy_only=False))
        if wanted is not None
        else None
    )
    rows = _matching_rows(symbols, wanted) if symbols is not None else None
    columns: dict[str, np.ndarray] = {}
    for name in output:
        if name == "ticker":
            # Encoded after filtering, not before: a category for a ticker the
            # caller excluded would travel with the frame and misreport the
            # universe it covers.
            column = table.column("ticker")
            columns[name] = batch_codes(
                _as_array(column if rows is None else column.take(pa.array(rows))), catalog
            )
            continue
        values = table.column(name)
        if name == "date":
            values = values.cast(pa.int32())
        array = np.asarray(values.to_numpy(zero_copy_only=False)).astype(
            _COMPACT_DTYPES[name], copy=False
        )
        if name == "date":
            array = array + np.int32(EPOCH_ORDINAL)
        columns[name] = array if rows is None else array[rows]
    return columns


def _as_array(column: pa.ChunkedArray | pa.Array) -> pa.Array:
    if isinstance(column, pa.Array):
        return column
    chunks = column.chunks
    return pa.concat_arrays(chunks) if chunks else pa.array([], type=column.type)


def _matching_rows(symbols: np.ndarray, wanted: np.ndarray) -> np.ndarray:
    """Row positions of the wanted tickers, using the panel's sort order.

    Each ticker's rows are one contiguous run, so two binary searches per
    ticker beat any per-row membership test -- and the runs come out already
    in order, so the result needs no sort.
    """
    starts = np.searchsorted(symbols, wanted, side="left")
    stops = np.searchsorted(symbols, wanted, side="right")
    runs = [np.arange(start, stop) for start, stop in zip(starts, stops) if stop > start]
    return np.concatenate(runs) if runs else np.empty(0, dtype=np.int64)


def _frame(
    parts: list[dict[str, np.ndarray]], output: list[str], catalog: dict[str, int]
) -> pd.DataFrame:
    columns: dict[str, object] = {}
    for name in output:
        pieces = [part[name] for part in parts]
        joined = (
            np.concatenate(pieces)
            if pieces
            else np.empty(0, dtype=np.int32 if name == "ticker" else _COMPACT_DTYPES[name])
        )
        columns[name] = categorical(joined, catalog) if name == "ticker" else joined
    return pd.DataFrame(
        {name: pd.Series(columns[name], copy=False) for name in output},
        columns=output,
        copy=False,
    )
