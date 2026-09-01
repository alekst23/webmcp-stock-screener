"""Appending one session to the stored panel, at the cost of one session.

The previous implementation keyed the *entire* panel by `(ticker, date)` in a
Python dict to decide which rows a nightly delta replaced -- roughly 1.4 GB of
index on the real universe to write ~6,000 rows, growing every night. The
guarantee it bought is not optional: a re-run session that duplicates a
ticker-day silently shifts every rolling window in the engine.

The same guarantee comes for free from the layout. The panel is already
sorted by `(ticker, date)` and so is the delta, so the two can be merged in
one streaming pass: read the panel a batch at a time, splice in the delta
rows that belong to that batch, write the result straight back out. Nothing
panel-sized is ever held, and the only index is the delta itself.

Output row groups are a fixed number of rows regardless of how the input was
chunked, which is what makes a re-applied session byte-identical rather than
merely equivalent.
"""

from __future__ import annotations

import io
from datetime import date

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from domain.models.panel import PanelStatus
from domain.models.price import PriceBar
from infra.panel_io import (
    EPOCH_ORDINAL,
    PANEL_COLUMNS,
    PANEL_ROW_GROUP_ROWS,
    bars_to_table,
    validate_wire_schema,
)

# Rows of the stored panel held at once while merging.
_MERGE_BATCH_ROWS = 64_000

_Columns = dict[str, np.ndarray]


def merge_panel_parquet(
    existing: bytes, incoming: list[PriceBar], source: str
) -> tuple[bytes, PanelStatus]:
    """Splice a delta into a stored panel, incoming rows winning on a tie.

    Returns the new panel bytes and its summary, the latter accumulated while
    streaming so the panel never has to be read a second time to describe it.
    """
    delta = _delta_columns(incoming)
    reader = pq.ParquetFile(pa.BufferReader(pa.py_buffer(existing)))
    validate_wire_schema(reader.schema_arrow)
    # A plain BytesIO rather than pa.BufferOutputStream: measured at ~60 MB
    # less peak on a 1.2M-row panel, because CPython's buffer can often grow
    # in place where arrow's resizable buffer copies.
    sink = io.BytesIO()
    tally = _Tally()
    with pq.ParquetWriter(sink, reader.schema_arrow) as writer:
        emitter = _Emitter(writer, reader.schema_arrow, tally)
        cursor = 0
        for batch in reader.iter_batches(batch_size=_MERGE_BATCH_ROWS, columns=PANEL_COLUMNS):
            columns = _batch_columns(batch)
            stop = _delta_upto(delta, cursor, _last_key(columns))
            emitter.add(_splice(columns, delta, cursor, stop))
            cursor = stop
        emitter.add(_slice(delta, cursor, len(delta["date"])))
        emitter.close()
    return sink.getvalue(), tally.status(source)


def _delta_columns(incoming: list[PriceBar]) -> _Columns:
    """The delta as wire-dtype arrays, deduplicated and sorted.

    Deduplicating here rather than during the merge is what makes a delta
    that repeats a ticker-day (two provider rows for one session) resolve to
    the last one, consistently with how it beats a stored row.
    """
    by_key = {(bar.ticker, bar.date): bar for bar in incoming}
    ordered = [by_key[key] for key in sorted(by_key)]
    return _table_columns(bars_to_table(ordered))


def _table_columns(table: pa.Table) -> _Columns:
    columns: _Columns = {}
    for name in PANEL_COLUMNS:
        column = table.column(name)
        if name == "date":
            column = column.cast(pa.int32())
        columns[name] = np.asarray(column.to_numpy(zero_copy_only=False))
    return columns


def _batch_columns(batch: pa.RecordBatch) -> _Columns:
    return _table_columns(pa.Table.from_batches([batch]))


def _last_key(columns: _Columns) -> tuple[str, int]:
    return (str(columns["ticker"][-1]), int(columns["date"][-1]))


def _delta_upto(delta: _Columns, cursor: int, last_key: tuple[str, int]) -> int:
    """How far into the delta belongs at or before `last_key`.

    Advancing a cursor rather than re-scanning means the delta is walked once
    across the whole merge, not once per batch.
    """
    tickers, dates = delta["ticker"], delta["date"]
    stop = cursor
    while stop < len(dates) and (str(tickers[stop]), int(dates[stop])) <= last_key:
        stop += 1
    return stop


def _slice(columns: _Columns, start: int, stop: int) -> _Columns:
    return {name: values[start:stop] for name, values in columns.items()}


def _splice(columns: _Columns, delta: _Columns, start: int, stop: int) -> _Columns:
    """One batch with its share of the delta merged in, order preserved.

    A delta row that lands on an existing `(ticker, date)` replaces it; one
    that does not is inserted at the position the sort order dictates.
    """
    if start == stop:
        return columns
    positions, collides = _positions(columns, delta, start, stop)
    dropped = positions[collides]
    keep = np.ones(len(columns["date"]), dtype=bool)
    keep[dropped] = False
    # Each insertion point shifts left by the number of rows dropped before
    # it; `positions` and `dropped` are both ascending, so one searchsorted
    # answers that for every row at once.
    insert_at = positions - np.searchsorted(dropped, positions, side="left")
    return {
        name: np.insert(values[keep], insert_at, delta[name][start:stop])
        for name, values in columns.items()
    }


def _positions(
    columns: _Columns, delta: _Columns, start: int, stop: int
) -> tuple[np.ndarray, np.ndarray]:
    """Where each delta row belongs in the batch, and whether it lands on an
    existing row. Two binary searches per delta row -- the delta is small and
    the batch is sorted, which is the whole point of the layout."""
    tickers, dates = columns["ticker"], columns["date"]
    positions = np.empty(stop - start, dtype=np.int64)
    collides = np.zeros(stop - start, dtype=bool)
    for offset, index in enumerate(range(start, stop)):
        ticker, day = delta["ticker"][index], delta["date"][index]
        low = int(np.searchsorted(tickers, ticker, side="left"))
        high = int(np.searchsorted(tickers, ticker, side="right"))
        position = low + int(np.searchsorted(dates[low:high], day, side="left"))
        positions[offset] = position
        collides[offset] = position < high and int(dates[position]) == int(day)
    return positions, collides


class _Tally:
    """The panel summary, accumulated as rows go past rather than by reading
    the finished panel back."""

    def __init__(self) -> None:
        self._rows = 0
        self._tickers: set[str] = set()
        self._first: int | None = None
        self._last: int | None = None

    def add(self, columns: _Columns) -> None:
        dates = columns["date"]
        if not len(dates):
            return
        self._rows += len(dates)
        self._tickers.update(np.unique(columns["ticker"]).tolist())
        low, high = int(dates.min()), int(dates.max())
        self._first = low if self._first is None else min(self._first, low)
        self._last = high if self._last is None else max(self._last, high)

    def status(self, source: str) -> PanelStatus:
        if self._first is None or self._last is None:
            raise ValueError("Cannot summarize an empty panel")
        return PanelStatus(
            as_of=date.fromordinal(self._last + EPOCH_ORDINAL),
            first_date=date.fromordinal(self._first + EPOCH_ORDINAL),
            ticker_count=len(self._tickers),
            row_count=self._rows,
            source=source,
        )


class _Emitter:
    """Buffers merged rows and writes row groups of a fixed size.

    Fixed-size groups are what make the output a function of its content
    alone: without them, re-applying a session would produce a panel that is
    equal but not byte-identical, because the second pass sees different
    batch boundaries than the first.
    """

    def __init__(self, writer: pq.ParquetWriter, schema: pa.Schema, tally: _Tally) -> None:
        self._writer = writer
        self._schema = schema
        self._tally = tally
        self._buffered: _Columns | None = None

    def add(self, columns: _Columns) -> None:
        if not len(columns["date"]):
            return
        self._tally.add(columns)
        self._buffered = columns if self._buffered is None else _concat(self._buffered, columns)
        while len(self._buffered["date"]) >= PANEL_ROW_GROUP_ROWS:
            self._write(_slice(self._buffered, 0, PANEL_ROW_GROUP_ROWS))
            self._buffered = _slice(
                self._buffered, PANEL_ROW_GROUP_ROWS, len(self._buffered["date"])
            )

    def close(self) -> None:
        if self._buffered is not None and len(self._buffered["date"]):
            self._write(self._buffered)
        self._buffered = None

    def _write(self, columns: _Columns) -> None:
        arrays = [
            pa.array(columns[name]).cast(pa.date32()) if name == "date" else pa.array(columns[name])
            for name in PANEL_COLUMNS
        ]
        table = pa.Table.from_arrays(arrays, names=PANEL_COLUMNS)
        self._writer.write_table(table.cast(self._schema))


def _concat(left: _Columns, right: _Columns) -> _Columns:
    return {name: np.concatenate([left[name], right[name]]) for name in PANEL_COLUMNS}
