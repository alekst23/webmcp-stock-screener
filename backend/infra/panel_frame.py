"""Compact in-memory representation of the price panel.

The mock panel (25 tickers) hid a sizing problem the real one exposes
immediately. Building the frame straight from `PriceBar.model_dump()` yields
an object column of per-row ticker strings, an object column of per-row
`datetime.date` instances, and float64 OHLC -- measured at ~141 bytes/row.
At the real universe's ~12M ticker-days that is ~1.7 GB, against a Render
free-tier web service capped at 512 MB (render.yaml).

The layout here is the one docs/reference/data-provider.md's sizing assumes:

| column        | dtype       | bytes/row |
| ticker        | category    | 2 (int16 codes over ~6k tickers) |
| date          | int32       | 4 (proleptic Gregorian ordinal)  |
| open/high/low/close | float32 | 16 (4 each) |
| volume        | uint32      | 4 |

-- 26 bytes/row, ~310 MB at 12M rows.

Two deviations from the sizing note, both deliberate:

*Dates are ordinals, not offsets into a shared calendar table.* An ordinal is
the same 4 bytes, is monotonic (so range filters are plain integer
comparisons), and needs no side table to interpret -- a shared lookup would
have to be threaded through every filtered view of the panel to stay
meaningful.

*Prices are float32, not scaled int32.* Fixed-point at the 4 decimal places
`PriceBar` carries needs a 10,000x scale factor, which overflows int32 above
$214,748 -- BRK.A trades near $712,000. float32 is the same 4 bytes, spans
the whole range, and keeps ~7 significant digits (worst case ~0.06 on a
$700k print, ~2e-10 on a sub-cent penny stock), far finer than any pattern
or return this engine measures.

`PriceBar` -- the domain contract -- is unchanged; this is purely how infra
stores what it was handed.

The positional lookups matter as much as the dtypes. Keying per-row dicts by
(ticker, date), as an earlier revision did, costs well over 100 bytes per
entry -- at 12M rows the *index* would dwarf the data it indexes. Because
the panel is sorted by (ticker, date), a per-ticker row range plus a binary
search over that range answers the same question in O(log n) with no
per-row storage at all.
"""

from __future__ import annotations

import random
from datetime import date

import numpy as np
import pandas as pd

from domain.models.price import PriceBar

PANEL_COLUMNS = ["ticker", "date", "open", "high", "low", "close", "volume"]
_PRICE_FIELDS = ("open", "high", "low", "close")


def bars_to_panel(bars: list[PriceBar]) -> pd.DataFrame:
    """Build the sorted, ticker-grouped, compact DataFrame the engine reads."""
    ordered = sorted(bars, key=lambda bar: (bar.ticker, bar.date))
    count = len(ordered)
    columns: dict[str, object] = {
        "ticker": pd.Categorical([bar.ticker for bar in ordered]),
        "date": np.fromiter((bar.date.toordinal() for bar in ordered), dtype=np.int32, count=count),
        "volume": np.fromiter((bar.volume for bar in ordered), dtype=np.uint32, count=count),
    }
    for field in _PRICE_FIELDS:
        columns[field] = np.fromiter(
            (getattr(bar, field) for bar in ordered), dtype=np.float32, count=count
        )
    return pd.DataFrame(columns, columns=PANEL_COLUMNS)


def float_column(frame: pd.DataFrame, name: str) -> pd.Series:
    """A base field as float64, for expression arithmetic.

    Transient by design: the compact column stays compact, and only the
    fields an expression actually names are ever widened.
    """
    return frame[name].astype("float64")


class PanelFrame:
    """The loaded panel plus the positional lookups the engine navigates by.

    Immutable after construction, which is what makes the cached column views
    and per-ticker row ranges safe to hold.
    """

    def __init__(self, frame: pd.DataFrame) -> None:
        self.frame = frame
        categorical = frame["ticker"]
        self._categories: list[str] = list(categorical.cat.categories)
        self._ticker_codes: np.ndarray = categorical.cat.codes.to_numpy()
        self._date_codes: np.ndarray = frame["date"].to_numpy()
        self._closes: np.ndarray = frame["close"].to_numpy()
        self._bounds = self._compute_bounds()

    @classmethod
    def from_bars(cls, bars: list[PriceBar]) -> "PanelFrame":
        return cls(bars_to_panel(bars))

    def _compute_bounds(self) -> dict[str, tuple[int, int]]:
        """ticker -> [start, stop) row range. One entry per ticker (~6k), not
        per row, so this stays kilobytes rather than gigabytes."""
        codes = self._ticker_codes
        starts = np.searchsorted(codes, np.arange(len(self._categories)), side="left")
        stops = np.searchsorted(codes, np.arange(len(self._categories)), side="right")
        return {
            ticker: (int(start), int(stop))
            for ticker, start, stop in zip(self._categories, starts, stops)
            if stop > start
        }

    def bounds(self, ticker: str) -> tuple[int, int] | None:
        return self._bounds.get(ticker)

    def row_position(self, ticker: str, on_date: date) -> int | None:
        """Absolute row index of (ticker, on_date), or None if absent."""
        found = self.bounds(ticker)
        if found is None:
            return None
        start, stop = found
        code = on_date.toordinal()
        offset = int(np.searchsorted(self._date_codes[start:stop], code, side="left"))
        if offset >= stop - start or int(self._date_codes[start + offset]) != code:
            return None
        return start + offset

    def date_at(self, position: int) -> date:
        return date.fromordinal(int(self._date_codes[position]))

    def close_at(self, position: int) -> float:
        return float(self._closes[position])

    def bar_at(self, position: int) -> PriceBar:
        row = self.frame.iloc[position]
        return PriceBar(
            ticker=str(row["ticker"]),
            date=date.fromordinal(int(row["date"])),
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=int(row["volume"]),
        )

    def anchor_sample(self, from_date: date, to_date: date, size: int) -> list[tuple[str, date]]:
        """A random sample of (ticker, date) anchors inside a date range.

        Samples row *positions* and only then materializes the pairs. Building
        the full candidate list first, as an earlier revision did, allocates
        one Python tuple per matching row -- tens of millions of them on the
        real panel, for a sample of 500.
        """
        codes = self._date_codes
        matching = np.flatnonzero((codes >= from_date.toordinal()) & (codes <= to_date.toordinal()))
        if len(matching) > size:
            matching = np.array(random.sample(list(matching), size))
        return [
            (self._categories[int(self._ticker_codes[position])], self.date_at(int(position)))
            for position in matching
        ]
