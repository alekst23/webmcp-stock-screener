"""T-0001-9: the real EODHD-backed pipeline, end to end without a network.

Every test here drives the production code path -- the real `EodhdClient`
over a stub transport carrying recorded EODHD response shapes, the real
Parquet serialization, the real object-store contract -- so what is exercised
is what the paid backfill will run. Nothing here makes a live (paid) call,
and nothing here needs an API key.
"""

from __future__ import annotations

import io
from datetime import date

import pandas as pd
import pytest

import main as main_module
from application.append_daily_delta import (
    append_daily_delta,
    latest_completed_trading_day,
)
from application.backfill_panel import backfill_panel
from application.load_panel import PANEL_KEY, UNIVERSE_KEY, load_panel
from domain.errors import PanelStoreError, PriceSourceError
from domain.models.price import PriceBar
from infra.eodhd_client import EodhdClient
from infra.nasdaq_screener import parse_screener_csv, universe_to_csv
from infra.panel_io import bars_to_parquet_bytes, parquet_bytes_to_bars
from scripts.generate_mock_panel import generate_panel, write_panel
from tests.mocks.fake_eodhd_transport import StubSession, bulk_row, eod_row
from tests.mocks.fake_panel_store import InMemoryPanelStore
from tests.unit.test_universe_eligibility import METADATA_AS_OF as AS_OF
from tests.unit.test_universe_eligibility import SCREENER_CSV

FROM_DATE = date(2024, 1, 2)
TO_DATE = date(2024, 1, 4)

# Two tickers over three days, in EODHD's documented per-ticker EOD shape.
_HISTORY = {
    "eod/AAPL.US": [
        eod_row("2024-01-02", 185.64),
        eod_row("2024-01-03", 184.25),
        eod_row("2024-01-04", 181.91),
    ],
    "eod/MSFT.US": [
        eod_row("2024-01-02", 370.87),
        eod_row("2024-01-03", 370.60),
        eod_row("2024-01-04", 367.94),
    ],
}


def _client() -> tuple[EodhdClient, StubSession]:
    session = StubSession(_HISTORY | {"eod-bulk-last-day/US": []})
    return EodhdClient("test-key-not-a-real-credential", session=session), session


class TestRealPanelConformance:
    def test_real_backfill_output_matches_price_bar_schema(self) -> None:
        # AC1: the real panel must be byte-for-byte the shape the mock
        # generator writes, so the engine, tools, and frontend need no change.
        store = InMemoryPanelStore()
        client, _ = _client()

        status = backfill_panel(
            client, store, ["AAPL.US", "MSFT.US"], FROM_DATE, TO_DATE, key=PANEL_KEY
        )

        written = pd.read_parquet(io.BytesIO(store.objects[PANEL_KEY]))
        mock_frame = pd.DataFrame([bar.model_dump() for bar in generate_panel()[:10]])
        assert list(written.columns) == list(mock_frame.columns), (
            f"real panel columns {list(written.columns)} must match the mock "
            f"generator's {list(mock_frame.columns)}"
        )
        assert written.dtypes.astype(str).tolist() == mock_frame.dtypes.astype(str).tolist(), (
            f"real panel dtypes {written.dtypes.to_dict()} must match the mock "
            f"generator's {mock_frame.dtypes.to_dict()}"
        )
        assert status.row_count == 6, f"expected 6 rows, got {status.row_count}"
        assert status.ticker_count == 2, f"expected 2 tickers, got {status.ticker_count}"
        assert status.as_of == TO_DATE, f"expected as_of {TO_DATE}, got {status.as_of}"

    def test_backfill_bars_carry_the_bare_symbol_and_adjusted_prices(self) -> None:
        # The per-ticker endpoint is addressed as SYMBOL.US and its rows carry
        # no ticker at all, so the panel's ticker comes from the request --
        # and every OHLC field must sit on the adjusted basis, not just close.
        store = InMemoryPanelStore()
        client, _ = _client()

        backfill_panel(client, store, ["AAPL.US"], FROM_DATE, TO_DATE, key=PANEL_KEY)

        bars = parquet_bytes_to_bars(store.objects[PANEL_KEY])
        tickers = {bar.ticker for bar in bars}
        assert tickers == {"AAPL"}, f"expected the bare symbol, got {tickers}"
        first = bars[0]
        raw = _HISTORY["eod/AAPL.US"][0]
        factor = raw["adjusted_close"] / raw["close"]
        assert first.close == round(raw["adjusted_close"], 4), f"got {first.close}"
        assert first.open == round(raw["open"] * factor, 4), f"got {first.open}"
        assert first.high == round(raw["high"] * factor, 4), f"got {first.high}"

    def test_backfill_uses_one_call_per_ticker(self) -> None:
        # The per-ticker range endpoint returns any length of history in a
        # single call; falling back to the bulk endpoint for backfill would
        # turn a minutes-long job into a quota-limited multi-day one.
        store = InMemoryPanelStore()
        client, session = _client()

        backfill_panel(client, store, ["AAPL.US", "MSFT.US"], FROM_DATE, TO_DATE, key=PANEL_KEY)

        assert len(session.requests) == 2, f"expected 2 calls, got {len(session.requests)}"

    def test_backfill_refuses_to_overwrite_the_panel_when_every_ticker_fails(self) -> None:
        # Silently replacing a good panel with an empty one is the worst
        # possible outcome of a bad run.
        store = InMemoryPanelStore({PANEL_KEY: b"existing-panel"})
        client = EodhdClient("test-key", session=StubSession({}, error=ValueError("boom")))

        with pytest.raises(PriceSourceError):
            backfill_panel(client, store, ["AAPL.US"], FROM_DATE, TO_DATE, key=PANEL_KEY)

        assert store.objects[PANEL_KEY] == b"existing-panel", "the stored panel was overwritten"


class TestNightlyDelta:
    def _seeded_store(self) -> InMemoryPanelStore:
        bars = [
            PriceBar(
                ticker="AAPL",
                date=FROM_DATE,
                open=1.0,
                high=2.0,
                low=0.5,
                close=1.5,
                volume=100,
            )
        ]
        return InMemoryPanelStore({PANEL_KEY: bars_to_parquet_bytes(bars)})

    def test_delta_appends_the_day_via_the_bulk_endpoint(self) -> None:
        store = self._seeded_store()
        session = StubSession({"eod-bulk-last-day/US": [bulk_row("AAPL", "2024-01-05", 190.0)]})
        client = EodhdClient("test-key", session=session)

        status = append_daily_delta(client, store, "US", date(2024, 1, 5), key=PANEL_KEY)

        assert status.as_of == date(2024, 1, 5), f"expected the appended day, got {status.as_of}"
        assert status.row_count == 2, f"expected 2 rows after the append, got {status.row_count}"
        assert len(session.requests) == 1, f"expected one bulk call, got {len(session.requests)}"

    def test_rerunning_the_same_day_does_not_duplicate_rows(self) -> None:
        # A retried cron run or a manual catch-up must not double-count a day
        # -- duplicate (ticker, date) rows silently shift every rolling window.
        store = self._seeded_store()
        session = StubSession({"eod-bulk-last-day/US": [bulk_row("AAPL", "2024-01-05", 190.0)]})
        client = EodhdClient("test-key", session=session)

        append_daily_delta(client, store, "US", date(2024, 1, 5), key=PANEL_KEY)
        status = append_daily_delta(client, store, "US", date(2024, 1, 5), key=PANEL_KEY)

        assert status.row_count == 2, f"expected 2 rows after a rerun, got {status.row_count}"

    def test_a_day_with_no_rows_leaves_the_panel_untouched(self) -> None:
        store = self._seeded_store()
        before = store.objects[PANEL_KEY]
        client = EodhdClient("test-key", session=StubSession({"eod-bulk-last-day/US": []}))

        append_daily_delta(client, store, "US", date(2024, 1, 6), key=PANEL_KEY)

        assert store.objects[PANEL_KEY] == before, "a holiday must not rewrite the panel"

    def test_delta_without_a_stored_panel_fails_loudly(self) -> None:
        client = EodhdClient("test-key", session=StubSession({}))

        with pytest.raises(PanelStoreError):
            append_daily_delta(client, InMemoryPanelStore(), "US", date(2024, 1, 5))

    def test_default_day_is_the_previous_weekday(self) -> None:
        # Monday's run must reach back to Friday, not to Sunday.
        assert latest_completed_trading_day(date(2026, 8, 31)) == date(2026, 8, 28)
        assert latest_completed_trading_day(date(2026, 9, 1)) == date(2026, 8, 31)


class TestStartupPanelResolution:
    def test_object_store_panel_wins_over_the_local_mock_panel(self) -> None:
        bars = [
            PriceBar(
                ticker="AAPL",
                date=date(2026, 8, 31),
                open=1.0,
                high=2.0,
                low=0.5,
                close=1.5,
                volume=100,
            )
        ]
        store = InMemoryPanelStore(
            {
                PANEL_KEY: bars_to_parquet_bytes(bars),
                UNIVERSE_KEY: universe_to_csv(parse_screener_csv(SCREENER_CSV, AS_OF)).encode(
                    "utf-8"
                ),
            }
        )

        loaded = load_panel(store, mock_path=main_module.PANEL_PATH)

        assert loaded is not None, "expected the stored panel to load"
        assert loaded.status.source == "object-store", f"got {loaded.status.source}"
        assert loaded.universe["AAPL"].sector == "Technology", "universe metadata did not load"

    def test_falls_back_to_the_mock_panel_when_no_object_store_is_configured(self) -> None:
        write_panel(generate_panel(), output_path=main_module.PANEL_PATH)

        loaded = load_panel(None, mock_path=main_module.PANEL_PATH)

        assert loaded is not None, "expected the mock panel to load"
        assert loaded.status.source == "mock", f"got {loaded.status.source}"

    # TestAsOfDateVisibility used to live here, exercising GET
    # /api/research/panel to confirm a response surfaces the panel's as-of
    # date, source, and ticker count. That route retired with the rest of
    # api/routes/research.py -- no surviving route serves panel-wide
    # provenance the same way, so the capability (and this test) retired
    # with it rather than being repointed at an unrelated route.
