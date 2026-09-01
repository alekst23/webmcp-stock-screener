"""The panel's on-the-wire Parquet format, in one place.

Both the mock generator (scripts/generate_mock_panel.py) and the real EODHD
pipeline must produce byte-identical row shapes, since the whole point of
T-0001-9 is swapping one panel for the other without touching the engine,
tools, or frontend. Every read and write of that format goes through here.

The bulk path deliberately does not go through `PriceBar`. Validating every
row with Pydantic to produce a frame that is 26 bytes/row costs ~1,560
bytes/row at the margin while it runs (measured; see T-1016-1) -- tens of
gigabytes on the real universe, which is why the backend could not boot on
real data at any instance size. The bulk path here costs ~63 bytes/row at
the margin, and the panel is the same frame either way. The schema gate is
therefore column-level (presence, order, arrow type): it catches producer
drift in constant time, and catches it before a single row is materialized.
`PriceBar` keeps its role at the single-bar boundary, where per-row
validation is worth what it costs.
"""

from __future__ import annotations

import io
from datetime import date
from typing import Callable, Sequence

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from domain.errors import PanelSchemaError
from domain.models.panel import PanelStatus
from domain.models.price import PriceBar

# Column order the mock generator writes (PriceBar field order). Pinned so a
# schema drift in either producer fails loudly here rather than surfacing as
# a mysterious engine result.
PANEL_COLUMNS = ["ticker", "date", "open", "high", "low", "close", "volume"]

_PRICE_COLUMNS = ("open", "high", "low", "close")

# Parquet's date32 counts days from the Unix epoch; the compact frame counts
# proleptic Gregorian ordinals (see infra/panel_frame.py). One constant
# converts between them, vectorized, with no per-row date objects.
EPOCH_ORDINAL = date(1970, 1, 1).toordinal()

# Rows of wire data held at once while filling the compact columns. Large
# enough that per-batch overhead disappears, small enough that the transient
# stays a rounding error against the panel it is filling.
_READ_BATCH_ROWS = 64_000

_TypeGate = Callable[[pa.DataType], bool]


def _is_string_like(field_type: pa.DataType) -> bool:
    return bool(
        pa.types.is_string(field_type)
        or pa.types.is_large_string(field_type)
        or pa.types.is_dictionary(field_type)
    )


# What each wire column must be, and how to say so when it is not. Type
# families rather than exact dtypes: a producer writing float32 prices or
# int32 volumes is compatible, one writing strings where prices belong is not.
_COLUMN_TYPES: dict[str, tuple[_TypeGate, str]] = {
    "ticker": (_is_string_like, "a string type"),
    "date": (pa.types.is_date, "a date type"),
    "open": (pa.types.is_floating, "a floating-point type"),
    "high": (pa.types.is_floating, "a floating-point type"),
    "low": (pa.types.is_floating, "a floating-point type"),
    "close": (pa.types.is_floating, "a floating-point type"),
    "volume": (pa.types.is_integer, "an integer type"),
}


def bars_to_parquet_bytes(bars: list[PriceBar]) -> bytes:
    """Serialize a panel, sorted by (ticker, date) as the engine expects."""
    ordered = sorted(bars, key=lambda bar: (bar.ticker, bar.date))
    buffer = io.BytesIO()
    pq.write_table(bars_to_table(ordered), buffer)
    return buffer.getvalue()


def bars_to_table(ordered: Sequence[PriceBar]) -> pa.Table:
    """Build the wire table column-wise from already-sorted bars.

    Column-wise because the obvious `DataFrame([bar.model_dump() ...])` costs
    one dict per row on top of the bars themselves.
    """
    count = len(ordered)
    arrays = [
        pa.array([bar.ticker for bar in ordered], type=pa.string()),
        pa.array(
            np.fromiter(
                (bar.date.toordinal() - EPOCH_ORDINAL for bar in ordered),
                dtype=np.int32,
                count=count,
            )
        ).cast(pa.date32()),
    ]
    for name in _PRICE_COLUMNS:
        arrays.append(
            pa.array(
                np.fromiter((getattr(bar, name) for bar in ordered), dtype=np.float64, count=count)
            )
        )
    arrays.append(
        pa.array(np.fromiter((bar.volume for bar in ordered), dtype=np.int64, count=count))
    )
    return pa.Table.from_arrays(arrays, names=PANEL_COLUMNS)


def parquet_bytes_to_panel(data: bytes) -> pd.DataFrame:
    """Parquet bytes -> the compact frame the engine reads, no row objects.

    The compact columns are allocated once at their final size and filled
    batch by batch, so the widest transient is one batch of wire data rather
    than a second copy of the panel. Three details each cost a full copy of
    the panel if got wrong, and all three were measured:

    * `pa.py_buffer` rather than `io.BytesIO`, which copies the bytes it wraps.
    * Batched reads rather than whole-column reads: arrow does not return a
      freed column to the OS before the next is read, so the peaks add up.
    * `copy=False` on construction, or pandas consolidates the columns into
      one block and the frame is built twice.
    """
    reader = pq.ParquetFile(pa.BufferReader(pa.py_buffer(data)))
    validate_wire_schema(reader.schema_arrow)
    total = reader.metadata.num_rows
    dates = np.empty(total, dtype=np.int32)
    prices = {name: np.empty(total, dtype=np.float32) for name in _PRICE_COLUMNS}
    volume = np.empty(total, dtype=np.uint32)
    codes = np.empty(total, dtype=np.int32)
    catalog: dict[str, int] = {}

    start = 0
    for batch in reader.iter_batches(batch_size=_READ_BATCH_ROWS, columns=PANEL_COLUMNS):
        stop = start + batch.num_rows
        codes[start:stop] = _batch_codes(batch.column("ticker"), catalog)
        dates[start:stop] = _to_numpy(batch.column("date").cast(pa.int32())) + EPOCH_ORDINAL
        for name in _PRICE_COLUMNS:
            prices[name][start:stop] = _to_numpy(batch.column(name))
        volume[start:stop] = _to_numpy(batch.column("volume"))
        start = stop

    columns: dict[str, object] = {"ticker": _categorical(codes, catalog), "date": dates}
    columns.update(prices)
    columns["volume"] = volume
    return pd.DataFrame(
        {name: pd.Series(columns[name], copy=False) for name in PANEL_COLUMNS},
        columns=PANEL_COLUMNS,
        copy=False,
    )


def parquet_bytes_to_bars(data: bytes) -> list[PriceBar]:
    """Deserialize a panel back into domain entities.

    The exact-precision path, for the single-bar boundary and for fixtures
    small enough that one object per row is affordable. The bulk path is
    `parquet_bytes_to_panel`.
    """
    reader = pq.ParquetFile(io.BytesIO(data))
    validate_wire_schema(reader.schema_arrow)
    frame = reader.read(columns=PANEL_COLUMNS).to_pandas()
    return [PriceBar(**row) for row in frame[PANEL_COLUMNS].to_dict("records")]


def validate_wire_schema(schema: pa.Schema) -> None:
    """The column-level schema gate: presence, order, and arrow type.

    Ordering is enforced rather than tolerated. A producer that reorders its
    output has drifted from the contract, and the reader below trusts
    position once past this check.
    """
    names = list(schema.names)
    missing = [column for column in PANEL_COLUMNS if column not in names]
    if missing:
        raise PanelSchemaError(f"Panel is missing required columns {missing}: got {names}")
    for position, expected in enumerate(PANEL_COLUMNS):
        actual = names[position]
        if actual != expected:
            raise PanelSchemaError(
                f"Panel column {position} is '{actual}', expected '{expected}': got {names}"
            )
        gate, described = _COLUMN_TYPES[expected]
        field_type = schema.field(position).type
        if not gate(field_type):
            raise PanelSchemaError(
                f"Panel column '{expected}' has type {field_type}, expected {described}"
            )


def _to_numpy(array: pa.Array) -> np.ndarray:
    return np.asarray(array.to_numpy(zero_copy_only=False))


def _batch_codes(column: pa.Array, catalog: dict[str, int]) -> np.ndarray:
    """One batch's tickers as codes into a catalog shared across batches.

    Arrow's dictionary encoding does the deduplication per batch; only each
    batch's distinct tickers (at most a few thousand, whatever the panel's
    size) are ever materialized as Python strings.
    """
    encoded = column.cast(pa.string()).dictionary_encode()
    local = encoded.dictionary.to_pylist()
    mapping = np.fromiter(
        (catalog.setdefault(ticker, len(catalog)) for ticker in local),
        dtype=np.int32,
        count=len(local),
    )
    return mapping[_to_numpy(encoded.indices).astype(np.int32, copy=False)]


def _categorical(codes: np.ndarray, catalog: dict[str, int]) -> pd.Categorical:
    """Codes plus a first-appearance catalog -> a pandas Categorical.

    The catalog is ordered by first appearance; pandas orders categories
    lexicographically. On a (ticker, date)-sorted panel the two coincide, but
    the frame must not depend on the panel being sorted to compare equal.
    """
    categories = np.array(list(catalog), dtype=object)
    if not len(categories):
        return pd.Categorical.from_codes(codes, categories=[])
    order = np.argsort(categories, kind="stable")
    ranks = np.empty(len(order), dtype=np.int32)
    ranks[order] = np.arange(len(order), dtype=np.int32)
    return pd.Categorical.from_codes(ranks[codes], categories=list(categories[order]))


def panel_status_from_parquet(data: bytes, source: str) -> PanelStatus:
    """Summarize a stored panel without unpacking it.

    Reads two columns a batch at a time, so describing a panel costs a scan
    rather than a copy -- which is what lets the nightly job answer "nothing
    to do" without ever holding the panel it declined to change.
    """
    reader = pq.ParquetFile(pa.BufferReader(pa.py_buffer(data)))
    validate_wire_schema(reader.schema_arrow)
    tickers: set[str] = set()
    rows, first, last = 0, None, None
    for batch in reader.iter_batches(batch_size=_READ_BATCH_ROWS, columns=["ticker", "date"]):
        dates = _to_numpy(batch.column("date").cast(pa.int32()))
        if not len(dates):
            continue
        rows += len(dates)
        tickers.update(np.unique(_to_numpy(batch.column("ticker"))).tolist())
        low, high = int(dates.min()), int(dates.max())
        first = low if first is None else min(first, low)
        last = high if last is None else max(last, high)
    if first is None or last is None:
        raise ValueError("Cannot summarize an empty panel")
    return PanelStatus(
        as_of=date.fromordinal(last + EPOCH_ORDINAL),
        first_date=date.fromordinal(first + EPOCH_ORDINAL),
        ticker_count=len(tickers),
        row_count=rows,
        source=source,
    )


def panel_status(bars: list[PriceBar], source: str) -> PanelStatus:
    """Summarize a loaded panel for the API's as-of surface (AC4)."""
    if not bars:
        raise ValueError("Cannot summarize an empty panel")
    dates = [bar.date for bar in bars]
    return PanelStatus(
        as_of=max(dates),
        first_date=min(dates),
        ticker_count=len({bar.ticker for bar in bars}),
        row_count=len(bars),
        source=source,
    )


def panel_status_from_frame(frame: pd.DataFrame, source: str) -> PanelStatus:
    """The same summary, read off the compact frame's columns."""
    if frame.empty:
        raise ValueError("Cannot summarize an empty panel")
    dates = frame["date"].to_numpy()
    return PanelStatus(
        as_of=date.fromordinal(int(dates.max())),
        first_date=date.fromordinal(int(dates.min())),
        ticker_count=int(frame["ticker"].nunique()),
        row_count=int(len(frame)),
        source=source,
    )
