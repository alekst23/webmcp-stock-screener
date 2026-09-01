"""The panel's on-the-wire Parquet format, in one place.

Both the mock generator (scripts/generate_mock_panel.py) and the real EODHD
pipeline must produce byte-identical row shapes, since the whole point of
T-1001-9 is swapping one panel for the other without touching the engine,
tools, or frontend. Every read and write of that format goes through here.
"""

from __future__ import annotations

import io

import pandas as pd

from domain.models.panel import PanelStatus
from domain.models.price import PriceBar

# Column order the mock generator writes (PriceBar field order). Pinned so a
# schema drift in either producer fails loudly here rather than surfacing as
# a mysterious engine result.
PANEL_COLUMNS = ["ticker", "date", "open", "high", "low", "close", "volume"]


def bars_to_parquet_bytes(bars: list[PriceBar]) -> bytes:
    """Serialize a panel, sorted by (ticker, date) as the engine expects."""
    ordered = sorted(bars, key=lambda bar: (bar.ticker, bar.date))
    frame = pd.DataFrame([bar.model_dump() for bar in ordered], columns=PANEL_COLUMNS)
    buffer = io.BytesIO()
    frame.to_parquet(buffer, index=False)
    return buffer.getvalue()


def parquet_bytes_to_bars(data: bytes) -> list[PriceBar]:
    """Deserialize a panel back into domain entities.

    Pydantic validation on every row is the schema gate: a panel written by a
    drifted producer fails here instead of silently reaching the engine.
    """
    frame = pd.read_parquet(io.BytesIO(data))
    missing = [column for column in PANEL_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"Panel is missing required columns {missing}: got {list(frame.columns)}")
    return [PriceBar(**row) for row in frame[PANEL_COLUMNS].to_dict("records")]


def merge_bars(existing: list[PriceBar], incoming: list[PriceBar]) -> list[PriceBar]:
    """Append a delta to a panel, with `incoming` winning on a collision.

    Re-running a nightly delta (a retried cron job, a manual catch-up over a
    long weekend) must be idempotent: the same day appended twice has to
    leave one row per (ticker, date), not two, or every rolling window in the
    engine silently shifts.
    """
    by_key = {(bar.ticker, bar.date): bar for bar in existing}
    by_key.update({(bar.ticker, bar.date): bar for bar in incoming})
    return sorted(by_key.values(), key=lambda bar: (bar.ticker, bar.date))


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
