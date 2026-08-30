"""Generate a synthetic daily-OHLCV panel for local development and tests.

Produces a small (~25-ticker) universe spanning several years, in the same
row shape (`PriceBar`) the real EODHD backfill (T-1001-9) will later
produce, so downstream components (query engine, WebMCP tools, frontend)
can be built against it at zero cost. A handful of tickers additionally
carry hand-authored occurrences of a known multi-step temporal pattern (see
`known_pattern_instances.py`) so T-1001-3's temporal matcher has a
hand-computable expected result to test against.

Run directly to (re)write the panel to disk:
    uv run python scripts/generate_mock_panel.py

Reproducibility (AC5): every random draw goes through a single
`numpy.random.default_rng(seed)` created once per call and consumed in a
fixed order (sorted ticker list, then chronological days), so the same seed
always reproduces the same panel, including the known pattern instances.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

if __package__ in (None, ""):
    # Allow `uv run python scripts/generate_mock_panel.py` as well as
    # `uv run python -m scripts.generate_mock_panel` — both are documented
    # entry points, and only the latter puts backend/ on sys.path by default.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd

from domain.models.price import PriceBar
from scripts.known_pattern_instances import KNOWN_PATTERN_INSTANCES, KnownPatternInstance

DEFAULT_SEED = 1001
TICKERS = [f"MOCK{n:02d}" for n in range(1, 26)]
START_DATE = date(2023, 1, 3)
END_DATE = date(2025, 12, 31)

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "mock" / "panel.parquet"

_DAILY_VOLATILITY = 0.02
_MIN_PRICE = 1.0

# Range-contraction narrows across the 4 fixed days of a known pattern
# instance: each day's (high - low) / center is smaller than the last.
_CONTRACTION_RANGE_PCTS = (0.045, 0.035, 0.025, 0.015)
_GAP_UP_PCT = 0.08
_BREAKOUT_BREAK_PCT = 0.03


def trading_calendar(start: date = START_DATE, end: date = END_DATE) -> list[date]:
    """Weekday calendar used by the mock panel. Not a real market-holiday
    calendar — that distinction belongs to the real pipeline (T-1001-9); a
    plain business-day range is enough for a synthetic dev/test fixture."""
    return [ts.date() for ts in pd.bdate_range(start, end)]


def _baseline_series(rng: np.random.Generator, calendar: list[date]) -> pd.DataFrame:
    """One ticker's ordinary (non-pattern) daily bars: a seeded geometric
    random walk on close, with open/high/low derived so low <= open, close
    <= high always holds."""
    start_price = float(rng.uniform(10.0, 250.0))
    log_returns = rng.normal(loc=0.0002, scale=_DAILY_VOLATILITY, size=len(calendar))
    closes = start_price * np.exp(np.cumsum(log_returns))
    closes = np.maximum(closes, _MIN_PRICE)

    prior_closes = np.concatenate(([start_price], closes[:-1]))
    open_jitter = rng.normal(loc=0.0, scale=0.005, size=len(calendar))
    opens = np.maximum(prior_closes * (1.0 + open_jitter), _MIN_PRICE)

    high_jitter = np.abs(rng.normal(loc=0.006, scale=0.004, size=len(calendar)))
    low_jitter = np.abs(rng.normal(loc=0.006, scale=0.004, size=len(calendar)))
    highs = np.maximum(opens, closes) * (1.0 + high_jitter)
    lows = np.minimum(opens, closes) * (1.0 - low_jitter)

    volumes = rng.lognormal(mean=13.0, sigma=0.5, size=len(calendar)).astype(int)

    return pd.DataFrame(
        {
            "date": calendar,
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": volumes,
        }
    )


def _known_pattern_bars(instance: KnownPatternInstance, center: float) -> dict[date, dict]:
    """Hand-computed OHLCV overrides for one known pattern instance,
    keyed by date. `center` is the close on the trading day immediately
    before `gap_date` (i.e. the last untouched baseline bar) — the pattern
    is expressed as fixed percentages off that level so every value here is
    hand-verifiable from the formulas in this function alone."""
    bars: dict[date, dict] = {}

    gap_open = center * (1.0 + _GAP_UP_PCT)
    gap_close = gap_open * 1.01
    bars[instance.gap_date] = {
        "open": gap_open,
        "high": gap_close * 1.015,
        "low": gap_open * 0.995,
        "close": gap_close,
        "volume": 3_000_000,
    }

    contraction_highs = []
    for day, range_pct in zip(instance.contraction_dates, _CONTRACTION_RANGE_PCTS):
        high = gap_close * (1.0 + range_pct / 2.0)
        low = gap_close * (1.0 - range_pct / 2.0)
        contraction_highs.append(high)
        bars[day] = {
            "open": gap_close,
            "high": high,
            "low": low,
            "close": gap_close,
            "volume": 800_000,
        }

    breakout_close = max(contraction_highs) * (1.0 + _BREAKOUT_BREAK_PCT)
    bars[instance.breakout_date] = {
        "open": gap_close,
        "high": breakout_close * 1.01,
        "low": gap_close * 0.998,
        "close": breakout_close,
        "volume": 4_000_000,
    }
    return bars


def _apply_known_instances(
    ticker_frames: dict[str, pd.DataFrame], calendar_index: dict[date, int]
) -> None:
    """Overwrite the relevant rows of each affected ticker's DataFrame in
    place with the hand-authored known-pattern bars."""
    for instance in KNOWN_PATTERN_INSTANCES:
        frame = ticker_frames[instance.ticker]
        anchor_idx = calendar_index[instance.gap_date]
        center = float(frame.loc[anchor_idx - 1, "close"])
        overrides = _known_pattern_bars(instance, center)
        for bar_date, values in overrides.items():
            row_idx = calendar_index[bar_date]
            for field, value in values.items():
                frame.loc[row_idx, field] = value


def generate_panel(seed: int = DEFAULT_SEED) -> list[PriceBar]:
    """Build the full synthetic panel: ordinary random-walk bars for every
    ticker, with the known pattern instances overlaid at their fixed
    ticker/date locations. Deterministic for a fixed seed (AC5)."""
    calendar = trading_calendar()
    calendar_index = {d: i for i, d in enumerate(calendar)}
    rng = np.random.default_rng(seed)

    ticker_frames = {ticker: _baseline_series(rng, calendar) for ticker in sorted(TICKERS)}
    _apply_known_instances(ticker_frames, calendar_index)

    bars: list[PriceBar] = []
    for ticker, frame in ticker_frames.items():
        for row in frame.itertuples(index=False):
            bars.append(
                PriceBar(
                    ticker=ticker,
                    date=row.date,
                    open=round(float(row.open), 4),
                    high=round(float(row.high), 4),
                    low=round(float(row.low), 4),
                    close=round(float(row.close), 4),
                    volume=int(row.volume),
                )
            )
    bars.sort(key=lambda b: (b.ticker, b.date))
    return bars


def write_panel(bars: list[PriceBar], output_path: Path = OUTPUT_PATH) -> Path:
    """Persist the panel as Parquet, matching the format the real pipeline
    (T-1001-9) will also write to."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frame = pd.DataFrame([bar.model_dump() for bar in bars])
    frame.to_parquet(output_path, index=False)
    return output_path


if __name__ == "__main__":
    panel = generate_panel()
    path = write_panel(panel)
    print(f"Wrote {len(panel)} rows for {len(TICKERS)} tickers to {path}")
