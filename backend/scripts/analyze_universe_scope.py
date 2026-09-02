"""Analyze the stored panel to recommend a universe floor (read-only).

This script only reads `panel.parquet` from the object store -- it never
writes to it, and it does not touch `universe.csv` or the nightly delta
path. It exists to turn "how big should the universe be" into numbers:
rows-per-ticker distribution, median dollar volume per ticker, and
candidate-floor survivor counts, panel sizes, and estimated resident
memory, cross-referenced against T-0016-9's measured container figures.

    uv run python scripts/analyze_universe_scope.py --panel-file <path>
    uv run python scripts/analyze_universe_scope.py --bucket <bucket>

`--panel-file` reads an already-downloaded copy (how this was actually run,
to avoid re-fetching the same read-only object repeatedly); omitting it
fetches straight from OBJECT_STORE_BUCKET / --bucket via the same
`infra.object_store` client the backend uses.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from infra.object_store import ObjectStoreConfig, S3PanelStore  # noqa: E402
from infra.pandas_engine import PandasPatternResearchEngine  # noqa: E402
from infra.panel_frame import PanelFrame  # noqa: E402
from infra.panel_io import parquet_bytes_to_panel  # noqa: E402
from scripts.measure_container_memory import (  # noqa: E402
    _COMPLEX_STEPS,
    _COMPLEX_STUDIES,
    _SIMPLE_STEPS,
    _SIMPLE_STUDIES,
)

# T-0016-9's measured absolute stages, kept here (not re-derived) so the
# extrapolation below cites exactly the figures the ticket recorded rather
# than a re-summary of them. All in bytes.
_T9_PANEL_ROWS = 2_338_597
_T9_PANEL_RESIDENT_BYTES = 60_990_506
_T9_APP_IMPORTS_RSS = 122.2e6
_T9_SIMPLE_BEFORE_SEARCH = 478.4e6
_T9_SIMPLE_PEAK = 1_409.9e6
_T9_SIMPLE_MATCHES = 1_225_899
_T9_COMPLEX_BEFORE_SEARCH = 455.5e6
_T9_COMPLEX_PEAK = 708.2e6
_T9_COMPLEX_MATCHES = 7_884
_T9_CEILING_BYTES = 2 * 1024**3

# Fixed data-independent overhead (interpreter + libraries + app imports) is
# subtracted out of "before_search" before scaling the remainder by panel
# size, since that overhead does not grow with the panel.
_SIMPLE_SCALABLE_BEFORE_SEARCH = _T9_SIMPLE_BEFORE_SEARCH - _T9_APP_IMPORTS_RSS
_COMPLEX_SCALABLE_BEFORE_SEARCH = _T9_COMPLEX_BEFORE_SEARCH - _T9_APP_IMPORTS_RSS

# Per-match delta observed for each pattern in T-0016-9 (peak minus
# before_search, divided by that run's completed-match count). The two
# patterns disagree by ~40x (760 vs ~32,000 bytes/match), so a candidate's
# search delta must be scaled using the ratio from the *same* pattern type,
# never a blended one -- this is the extrapolation's largest source of
# uncertainty and is stated as such in the report.
_SIMPLE_BYTES_PER_MATCH = (_T9_SIMPLE_PEAK - _T9_SIMPLE_BEFORE_SEARCH) / _T9_SIMPLE_MATCHES
_COMPLEX_BYTES_PER_MATCH = (_T9_COMPLEX_PEAK - _T9_COMPLEX_BEFORE_SEARCH) / _T9_COMPLEX_MATCHES

_DOLLAR_VOLUME_THRESHOLDS = (250_000, 1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000)
_HISTORY_THRESHOLDS = {"60d": 60, "1y": 252, "2y": 504, "trend200": 200}


def _fetch_panel_bytes(bucket: str) -> bytes:
    store = S3PanelStore(ObjectStoreConfig(bucket=bucket, region="us-east-1"))
    store.ensure_reachable()
    return store.get_object("panel.parquet")


def load_frame(panel_file: str | None, bucket: str | None) -> tuple[pd.DataFrame, int]:
    if panel_file:
        data = Path(panel_file).read_bytes()
    else:
        if not bucket:
            raise SystemExit("Pass --panel-file or --bucket (or set OBJECT_STORE_BUCKET).")
        data = _fetch_panel_bytes(bucket)
    return parquet_bytes_to_panel(data), len(data)


def describe_current(frame: pd.DataFrame, compressed_bytes: int) -> dict[str, Any]:
    rows_per_ticker = frame.groupby("ticker", observed=True).size()
    deciles = rows_per_ticker.quantile([i / 10 for i in range(11)]).round(1).to_dict()
    poison = {
        label: int((rows_per_ticker < minimum).sum())
        for label, minimum in _HISTORY_THRESHOLDS.items()
    }
    resident_bytes = int(frame.memory_usage(deep=True).sum())
    return {
        "ticker_count": int(frame["ticker"].nunique()),
        "row_count": int(len(frame)),
        "date_min": str(date.fromordinal(int(frame["date"].min()))),
        "date_max": str(date.fromordinal(int(frame["date"].max()))),
        "compressed_bytes": compressed_bytes,
        "resident_bytes": resident_bytes,
        "resident_bytes_per_row": round(resident_bytes / len(frame), 2),
        "rows_per_ticker_deciles": {f"p{int(k*100)}": v for k, v in deciles.items()},
        "rows_per_ticker_mean": round(float(rows_per_ticker.mean()), 1),
        "tickers_below_history_threshold": poison,
    }


def recent_window_dollar_volume(frame: pd.DataFrame, window_sessions: int) -> pd.Series:
    """Median (close * volume) per ticker over the panel's most recent N
    distinct session dates, market-wide (not per-ticker last-N, so a
    delisted/stale ticker with no rows in the window correctly drops out
    rather than reporting a median from years-old activity)."""
    recent_dates = np.sort(frame["date"].unique())[-window_sessions:]
    windowed = frame[frame["date"].isin(recent_dates)]
    dollar_volume = windowed["close"].astype("float64") * windowed["volume"].astype("float64")
    return dollar_volume.groupby(windowed["ticker"], observed=True).median()


def decile_table(series: pd.Series) -> dict[str, float]:
    deciles = series.quantile([i / 10 for i in range(11)])
    return {f"p{int(k*100)}": round(float(v), 2) for k, v in deciles.items()}


def threshold_survivors(series: pd.Series, thresholds: tuple[int, ...]) -> dict[int, int]:
    return {t: int((series >= t).sum()) for t in thresholds}


@dataclass
class BytesPerRowModel:
    """Resident-memory-per-row depends on the ticker-category code width
    (int16 up to 32,767 categories, int32 above -- pandas' own promotion
    rule) plus the category dictionary itself. Fit from the currently
    measured panel rather than assumed, so it is exact for "no filter" and
    still close for any smaller candidate."""

    fixed_numeric_bytes_per_row: float
    category_dict_bytes_per_ticker: float

    @classmethod
    def fit(cls, frame: pd.DataFrame) -> "BytesPerRowModel":
        usage = frame.memory_usage(deep=True)
        numeric_cols = ["date", "open", "high", "low", "close", "volume"]
        numeric_bytes_per_row = float(usage[numeric_cols].sum()) / len(frame)
        ticker_codes_bytes = frame["ticker"].cat.codes.nbytes
        dict_bytes = float(usage["ticker"]) - ticker_codes_bytes
        n_tickers = frame["ticker"].nunique()
        return cls(
            fixed_numeric_bytes_per_row=numeric_bytes_per_row,
            category_dict_bytes_per_ticker=dict_bytes / n_tickers,
        )

    def estimate(self, rows: int, tickers: int) -> int:
        code_bytes = 2 if tickers <= 32_767 else 4
        return int(
            rows * (self.fixed_numeric_bytes_per_row + code_bytes)
            + tickers * self.category_dict_bytes_per_ticker
        )


def threshold_table(
    frame: pd.DataFrame,
    dollar_volume: pd.Series,
    thresholds: tuple[int, ...],
    compressed_bytes: int,
    total_rows: int,
    model: BytesPerRowModel,
) -> list[dict[str, Any]]:
    rows_per_ticker = frame.groupby("ticker", observed=True).size()
    rows = []
    for t in thresholds:
        survivors = dollar_volume[dollar_volume >= t].index
        survivor_rows = int(rows_per_ticker.reindex(survivors).sum())
        rows.append(
            {
                "floor_usd": t,
                "tickers": len(survivors),
                "rows": survivor_rows,
                "estimated_compressed_bytes": int(compressed_bytes * survivor_rows / total_rows),
                "estimated_resident_bytes": model.estimate(survivor_rows, len(survivors)),
            }
        )
    return rows


def cross_tab(
    frame: pd.DataFrame,
    dollar_volume: pd.Series,
    dv_floors: tuple[int, ...],
    price_floors: tuple[float, ...],
    history_floors: dict[str, int],
) -> list[dict[str, Any]]:
    last_close = frame.groupby("ticker", observed=True)["close"].last().astype("float64")
    rows_per_ticker = frame.groupby("ticker", observed=True).size()
    combos = []
    for dv in dv_floors:
        dv_pass = set(dollar_volume[dollar_volume >= dv].index)
        for price in price_floors:
            price_pass = set(last_close[last_close >= price].index)
            for hist_label, hist_min in history_floors.items():
                hist_pass = set(rows_per_ticker[rows_per_ticker >= hist_min].index)
                survivors = dv_pass & price_pass & hist_pass
                combos.append(
                    {
                        "dollar_volume_floor": dv,
                        "price_floor": price,
                        "history_floor": hist_label,
                        "tickers": len(survivors),
                        "rows": int(rows_per_ticker.reindex(list(survivors)).sum()),
                    }
                )
    return combos


def _filtered_frame(frame: pd.DataFrame, survivors: set[str]) -> pd.DataFrame:
    subset = frame[frame["ticker"].isin(survivors)].copy()
    subset["ticker"] = subset["ticker"].cat.remove_unused_categories()
    return subset


def _run_pattern(frame: pd.DataFrame, studies: dict[str, str], steps: list[dict[str, Any]]) -> Any:
    from domain.models.pattern import SetupStep

    engine = PandasPatternResearchEngine(PanelFrame(frame))
    for name, expression in studies.items():
        engine.define_study(name, expression)
    setup = engine.define_setup("universe_scope_measure", [SetupStep(**s) for s in steps])
    return engine.find_instances(setup)


def extrapolate_memory(
    frame: pd.DataFrame,
    survivors: set[str],
    model: BytesPerRowModel,
    compressed_bytes: int,
    total_rows: int,
) -> dict[str, Any]:
    """Real match/anchor counts from running the exact T-0016-9 patterns
    against this candidate universe locally (counts only -- not a memory
    measurement; this machine is not the container), then peak RSS is
    extrapolated using T-0016-9's own measured ratios. Two ratios, kept
    separate per pattern, because per-match cost differs ~40x between the
    two patterns measured -- see the module-level comment.
    """
    subset = _filtered_frame(frame, survivors)
    resident_bytes = model.estimate(len(subset), len(survivors))
    scale = resident_bytes / _T9_PANEL_RESIDENT_BYTES

    simple_result = _run_pattern(subset, _SIMPLE_STUDIES, _SIMPLE_STEPS)
    complex_result = _run_pattern(subset, _COMPLEX_STUDIES, _COMPLEX_STEPS)

    simple_before_search = _T9_APP_IMPORTS_RSS + _SIMPLE_SCALABLE_BEFORE_SEARCH * scale
    complex_before_search = _T9_APP_IMPORTS_RSS + _COMPLEX_SCALABLE_BEFORE_SEARCH * scale

    simple_peak = simple_before_search + simple_result.complete_count * _SIMPLE_BYTES_PER_MATCH
    complex_peak = complex_before_search + complex_result.complete_count * _COMPLEX_BYTES_PER_MATCH

    return {
        "tickers": len(survivors),
        "rows": len(subset),
        "resident_bytes": resident_bytes,
        "scale_vs_t9_panel": round(scale, 3),
        "simple_broad": {
            "matches": simple_result.complete_count,
            "estimated_before_search_bytes": int(simple_before_search),
            "estimated_peak_bytes": int(simple_peak),
            "estimated_headroom_pct": round(
                100 * (_T9_CEILING_BYTES - simple_peak) / _T9_CEILING_BYTES, 1
            ),
        },
        "complex_realistic": {
            "matches": complex_result.complete_count,
            "estimated_before_search_bytes": int(complex_before_search),
            "estimated_peak_bytes": int(complex_peak),
            "estimated_headroom_pct": round(
                100 * (_T9_CEILING_BYTES - complex_peak) / _T9_CEILING_BYTES, 1
            ),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel-file", default=None)
    parser.add_argument("--bucket", default=None)
    parser.add_argument("--window-sessions", type=int, default=60)
    args = parser.parse_args()

    frame, compressed_bytes = load_frame(args.panel_file, args.bucket)
    total_rows = len(frame)
    model = BytesPerRowModel.fit(frame)

    current = describe_current(frame, compressed_bytes)
    dollar_volume = recent_window_dollar_volume(frame, args.window_sessions)
    dv_deciles = decile_table(dollar_volume)
    dv_survivors = threshold_survivors(dollar_volume, _DOLLAR_VOLUME_THRESHOLDS)
    dv_table = threshold_table(
        frame, dollar_volume, _DOLLAR_VOLUME_THRESHOLDS, compressed_bytes, total_rows, model
    )
    combos = cross_tab(
        frame,
        dollar_volume,
        dv_floors=(1_000_000, 5_000_000, 10_000_000),
        price_floors=(1.0, 5.0),
        history_floors={"1y": 252, "2y": 504},
    )

    candidates = {
        "1M_1yr": (dollar_volume >= 1_000_000),
        "5M_1yr": (dollar_volume >= 5_000_000),
        "10M_2yr": (dollar_volume >= 10_000_000),
    }
    rows_per_ticker = frame.groupby("ticker", observed=True).size()
    last_close = frame.groupby("ticker", observed=True)["close"].last().astype("float64")
    memory_estimates = {}
    for label, dv_mask in candidates.items():
        hist_min = 504 if "2yr" in label else 252
        survivors = (
            set(dollar_volume[dv_mask].index)
            & set(rows_per_ticker[rows_per_ticker >= hist_min].index)
            & set(last_close[last_close >= 1.0].index)
        )
        memory_estimates[label] = extrapolate_memory(
            frame, survivors, model, compressed_bytes, total_rows
        )

    output = {
        "current": current,
        "bytes_per_row_model": {
            "fixed_numeric_bytes_per_row": round(model.fixed_numeric_bytes_per_row, 3),
            "category_dict_bytes_per_ticker": round(model.category_dict_bytes_per_ticker, 2),
        },
        "dollar_volume_deciles_usd": dv_deciles,
        "dollar_volume_threshold_survivors": dv_survivors,
        "threshold_table": dv_table,
        "cross_tab_price_history_dollarvol": combos,
        "memory_extrapolation": memory_estimates,
    }
    print(json.dumps(output, indent=2, default=str))


if __name__ == "__main__":
    main()
