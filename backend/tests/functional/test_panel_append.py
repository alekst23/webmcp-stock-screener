"""T-1016-2: appending a session costs a session, and stays idempotent.

The guarantee under test is narrow and load-bearing: re-applying a session
must leave one row per (ticker, date). A duplicate row silently shifts every
rolling window in the engine, so it fails as a wrong answer rather than as an
error -- which is why the byte-identity check here is worth more than a row
count.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from application.append_daily_delta import (
    PANEL_KEY,
    append_sessions,
    catch_up_sessions,
    latest_completed_trading_day,
)
from domain.models.price import PriceBar
from domain.trading_calendar import sessions_between
from infra.panel_append import merge_panel_parquet
from infra.panel_frame import PanelFrame
from infra.panel_io import EPOCH_ORDINAL, PANEL_COLUMNS, parquet_bytes_to_panel
from tests.mocks.fake_panel_store import InMemoryPanelStore

START = date(2024, 1, 1)
SOURCE = "object-store"


def _panel_bytes(tickers: list[str], days: int, start: date = START) -> bytes:
    """A wire-format panel built column-wise, so a 150k-row fixture stays
    cheap enough to use in a functional test."""
    rows = len(tickers) * days
    origin = start.toordinal() - EPOCH_ORDINAL
    dates = np.tile(np.arange(origin, origin + days, dtype=np.int32), len(tickers))
    prices = np.linspace(10.0, 20.0, rows, dtype=np.float64)
    table = pa.Table.from_arrays(
        [
            pa.array(np.repeat(np.array(sorted(tickers), dtype=object), days), type=pa.string()),
            pa.array(dates).cast(pa.date32()),
            pa.array(prices),
            pa.array(prices + 1.0),
            pa.array(prices - 1.0),
            pa.array(prices + 0.5),
            pa.array(np.full(rows, 1_000, dtype=np.int64)),
        ],
        names=PANEL_COLUMNS,
    )
    sink = pa.BufferOutputStream()
    pq.write_table(table, sink)
    return bytes(sink.getvalue().to_pybytes())


def _bar(ticker: str, day: date, close: float = 99.0) -> PriceBar:
    return PriceBar(
        ticker=ticker,
        date=day,
        open=close - 1.0,
        high=close + 1.0,
        low=close - 2.0,
        close=close,
        volume=5_000,
    )


class _FakeSource:
    """A PriceSource that publishes one bulk row per ticker per session."""

    def __init__(self, sessions: dict[date, list[PriceBar]]) -> None:
        self._sessions = sessions
        self.requested: list[date] = []

    def fetch_history(self, ticker: str, from_date: date, to_date: date) -> list[PriceBar]:
        raise AssertionError("the delta path must not call the per-ticker endpoint")

    def fetch_exchange_day(self, exchange: str, day: date) -> list[PriceBar]:
        self.requested.append(day)
        return list(self._sessions.get(day, []))


class TestIdempotency:
    def test_applying_a_session_twice_is_byte_identical_to_applying_it_once(self) -> None:
        # AC2. Sized past both the 64k merge batch and the 100k row group so
        # the second pass sees different batch boundaries than the first --
        # which is exactly where an "equal but not identical" panel comes from.
        panel = _panel_bytes([f"T{index:03d}" for index in range(300)], days=500)
        session = [_bar(f"T{index:03d}", START + timedelta(days=500)) for index in range(300)]

        once, first = merge_panel_parquet(panel, session, SOURCE)
        twice, second = merge_panel_parquet(once, session, SOURCE)

        assert twice == once, "re-applying a session changed the stored panel"
        assert second.row_count == first.row_count, f"{second.row_count} != {first.row_count}"
        assert first.row_count == 300 * 501, f"expected 150,300 rows, got {first.row_count}"

    def test_a_replayed_row_replaces_rather_than_duplicates(self) -> None:
        panel = _panel_bytes(["AAA", "BBB"], days=3)
        replacement = [_bar("AAA", START + timedelta(days=1), close=123.5)]

        merged, status = merge_panel_parquet(panel, replacement, SOURCE)

        assert status.row_count == 6, f"expected the row replaced, not added: {status.row_count}"
        frame = parquet_bytes_to_panel(merged)
        position = PanelFrame(frame).row_position("AAA", START + timedelta(days=1))
        assert position is not None, "the replaced row went missing"
        assert frame["close"].iloc[position] == pytest.approx(123.5), f"{frame.iloc[position]}"

    def test_a_delta_repeating_a_ticker_day_keeps_only_the_last_row(self) -> None:
        panel = _panel_bytes(["AAA"], days=2)
        day = START + timedelta(days=5)

        merged, status = merge_panel_parquet(
            panel, [_bar("AAA", day, 1.0), _bar("AAA", day, 2.0)], SOURCE
        )

        assert status.row_count == 3, f"expected one row for the session: {status.row_count}"
        frame = parquet_bytes_to_panel(merged)
        assert frame["close"].iloc[-1] == pytest.approx(2.0), f"{frame.tail(1)}"


class TestOrderingAndCoverage:
    def test_a_ticker_absent_from_the_panel_is_added_in_sorted_position(self) -> None:
        # AC4: a newly-listed ticker arrives in a bulk session before it has
        # any history, and must not be dropped or land at the end.
        panel = _panel_bytes(["AAA", "CCC"], days=3)

        merged, status = merge_panel_parquet(panel, [_bar("BBB", START)], SOURCE)

        frame = parquet_bytes_to_panel(merged)
        assert status.ticker_count == 3, f"expected 3 tickers, got {status.ticker_count}"
        assert list(frame["ticker"].astype(str)) == (
            ["AAA"] * 3 + ["BBB"] + ["CCC"] * 3
        ), f"sort order broken: {list(frame['ticker'].astype(str))}"

    def test_the_panel_stays_sorted_by_ticker_then_date(self) -> None:
        # AC5: PanelFrame's per-ticker row ranges and binary searches are only
        # correct on a sorted panel, so this is the engine's real invariant.
        panel = _panel_bytes(["AAA", "CCC"], days=4)
        session = [_bar("BBB", START + timedelta(days=1)), _bar("AAA", START + timedelta(days=9))]

        merged, _ = merge_panel_parquet(panel, session, SOURCE)

        frame = parquet_bytes_to_panel(merged)
        keys = list(zip(frame["ticker"].astype(str), frame["date"]))
        assert keys == sorted(keys), f"panel is not sorted by (ticker, date): {keys}"
        assert PanelFrame(frame).row_position("BBB", START + timedelta(days=1)) is not None


class TestCatchUp:
    def _store(self) -> InMemoryPanelStore:
        return InMemoryPanelStore({PANEL_KEY: _panel_bytes(["AAA", "BBB"], days=2)})

    def test_a_catch_up_applies_every_missed_session_and_reports_the_newest(self) -> None:
        # AC3.
        store = self._store()
        days = [START + timedelta(days=offset) for offset in (5, 6, 7)]
        source = _FakeSource({day: [_bar("AAA", day), _bar("BBB", day)] for day in days})

        status = append_sessions(source, store, "US", list(reversed(days)), key=PANEL_KEY)

        assert status.as_of == days[-1], f"expected the newest session, got {status.as_of}"
        assert status.row_count == 4 + 6, f"expected every session applied: {status.row_count}"
        assert source.requested == days, f"sessions were not fetched in order: {source.requested}"
        assert store.put_count == 1, f"a catch-up must cost one rewrite, not {store.put_count}"

    def test_a_catch_up_of_holidays_leaves_the_panel_untouched(self) -> None:
        store = self._store()
        before = store.objects[PANEL_KEY]

        status = append_sessions(_FakeSource({}), store, "US", [START], key=PANEL_KEY)

        assert store.objects[PANEL_KEY] == before, "an empty session rewrote the panel"
        assert status.row_count == 4, f"the untouched panel must still describe itself: {status}"

    def test_catch_up_resumes_from_the_panel_own_as_of_date(self) -> None:
        # AC3: after a run of failed nights nobody has a record of which ones
        # were missed -- the panel's as-of date is the only durable answer.
        store = self._store()
        sessions = {
            day: [_bar("AAA", day)]
            for day in (date(2024, 1, 3), date(2024, 1, 4), date(2024, 1, 5))
        }
        source = _FakeSource(sessions)

        status = catch_up_sessions(source, store, "US", date(2024, 1, 5), key=PANEL_KEY)

        assert source.requested == sorted(sessions), f"got {source.requested}"
        assert status.as_of == date(2024, 1, 5), f"got {status.as_of}"
        assert status.row_count == 4 + 3, f"expected each missed session applied: {status}"

    def test_sessions_between_lists_weekdays_after_the_panel_as_of(self) -> None:
        # Friday 2026-08-28 through Wednesday 2026-09-02.
        assert sessions_between(date(2026, 8, 28), date(2026, 9, 2)) == [
            date(2026, 8, 31),
            date(2026, 9, 1),
            date(2026, 9, 2),
        ]
        assert sessions_between(date(2026, 9, 1), date(2026, 9, 1)) == []
        assert latest_completed_trading_day(date(2026, 8, 31)) == date(2026, 8, 28)
