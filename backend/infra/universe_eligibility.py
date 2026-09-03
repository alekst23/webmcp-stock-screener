"""Computing and persisting the enforced universe's eligible-ticker set.

The rule itself (the three thresholds, and what "clears the floor" means)
lives in `domain/universe_floor.py`; this module is the mechanics of
measuring a panel's tickers against that rule and round-tripping the result
as a stored CSV object, `universe_eligibility.csv`, alongside `panel.parquet`.

Distinct from `infra/nasdaq_screener.py`'s `universe.csv`: that object is
sourced from a Nasdaq screener export and never gates panel content. This
one is computed entirely from the panel's own trailing price/volume history
and is what `application/backfill_panel.py` and
`application/append_daily_delta.py` consult to decide what may enter
`panel.parquet`. See
docs/plan/EPIC-0016/T-0016-13-universe-enforcement.md.
"""

from __future__ import annotations

import csv
import io
from datetime import date

import numpy as np
import pandas as pd

from domain.models.universe import EligibilityRecord
from domain.universe_floor import DOLLAR_VOLUME_WINDOW_SESSIONS, passes_floor

ELIGIBILITY_KEY = "universe_eligibility.csv"

_ELIGIBILITY_COLUMNS = ["ticker", "median_dollar_volume", "last_close", "history_sessions", "as_of"]


def compute_eligible_universe(frame: pd.DataFrame, as_of: date) -> dict[str, EligibilityRecord]:
    """Every ticker in `frame` that clears the enforced floor, as of `as_of`.

    `frame` is the compact panel frame (`infra/panel_frame.py`'s layout, or
    anything with the same `ticker`/`date`/`close`/`volume` columns) --
    typically the whole stored panel, but callers may pass any subset (e.g.
    a freshly fetched backfill before it is ever written).
    """
    if frame.empty:
        return {}
    dollar_volume = recent_window_dollar_volume(frame, DOLLAR_VOLUME_WINDOW_SESSIONS)
    last_close = frame.groupby("ticker", observed=True)["close"].last().astype("float64")
    history = frame.groupby("ticker", observed=True).size()

    records: dict[str, EligibilityRecord] = {}
    for ticker, median_dv in dollar_volume.items():
        close = float(last_close.get(ticker, 0.0))
        sessions = int(history.get(ticker, 0))
        if passes_floor(float(median_dv), close, sessions):
            records[str(ticker)] = EligibilityRecord(
                ticker=str(ticker),
                median_dollar_volume=float(median_dv),
                last_close=close,
                history_sessions=sessions,
                as_of=as_of,
            )
    return records


def recent_window_dollar_volume(frame: pd.DataFrame, window_sessions: int) -> pd.Series:
    """Median (close * volume) per ticker over the panel's most recent N
    distinct session dates, market-wide (not per-ticker last-N, so a stale
    ticker with no rows in the window correctly reports no volume there
    rather than a median computed from years-old activity).

    The single canonical implementation `compute_eligible_universe` applies
    against the enforced floor -- kept as its own function so the dollar-
    volume computation can be reasoned about (and tested) independently of
    the floor comparison built on top of it.
    """
    recent_dates = np.sort(frame["date"].unique())[-window_sessions:]
    windowed = frame[frame["date"].isin(recent_dates)]
    dollar_volume = windowed["close"].astype("float64") * windowed["volume"].astype("float64")
    return dollar_volume.groupby(windowed["ticker"], observed=True).median()


def eligibility_to_csv(records: dict[str, EligibilityRecord]) -> str:
    """Round-trip the eligible set out as CSV, sorted by ticker."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(_ELIGIBILITY_COLUMNS)
    for record in sorted(records.values(), key=lambda item: item.ticker):
        writer.writerow(
            [
                record.ticker,
                record.median_dollar_volume,
                record.last_close,
                record.history_sessions,
                record.as_of.isoformat(),
            ]
        )
    return buffer.getvalue()


def eligibility_from_csv(text: str) -> dict[str, EligibilityRecord]:
    """Read back what `eligibility_to_csv` wrote."""
    records: dict[str, EligibilityRecord] = {}
    for row in csv.DictReader(io.StringIO(text)):
        ticker = (row.get("ticker") or "").strip().upper()
        if not ticker:
            continue
        records[ticker] = EligibilityRecord(
            ticker=ticker,
            median_dollar_volume=float(row["median_dollar_volume"]),
            last_close=float(row["last_close"]),
            history_sessions=int(row["history_sessions"]),
            as_of=date.fromisoformat(row["as_of"].strip()),
        )
    return records
