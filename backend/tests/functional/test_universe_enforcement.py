"""T-0016-13: the enforced universe floor applied at ingest and in the
nightly delta -- the two places docs/reference/universe-scope-analysis.md's
"enforcement gap" section named as required, or the floor re-expands the
panel on the next nightly run regardless of what it is set to.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

import pytest

from application.append_daily_delta import PANEL_KEY as DELTA_PANEL_KEY
from application.append_daily_delta import append_daily_delta
from application.backfill_panel import PANEL_KEY as BACKFILL_PANEL_KEY
from application.backfill_panel import backfill_panel
from domain.errors import PriceSourceError
from domain.models.price import PriceBar
from domain.models.universe import EligibilityRecord
from infra.panel_frame import bars_to_panel
from infra.panel_io import bars_to_parquet_bytes, parquet_bytes_to_bars, parquet_bytes_to_panel
from infra.universe_eligibility import (
    ELIGIBILITY_KEY,
    compute_eligible_universe,
    eligibility_from_csv,
    eligibility_to_csv,
)
from tests.mocks.fake_panel_store import InMemoryPanelStore

START = date(2024, 1, 1)
FROM_DATE = START
TO_DATE = START + timedelta(days=299)


def _history(
    ticker: str, days: int, close: float, volume: int, start: date = START
) -> list[PriceBar]:
    return [
        PriceBar(
            ticker=ticker,
            date=start + timedelta(days=offset),
            open=close,
            high=close + 1.0,
            low=max(close - 1.0, 0.01),
            close=close,
            volume=volume,
        )
        for offset in range(days)
    ]


def _bar(ticker: str, day: date, close: float, volume: int) -> PriceBar:
    return PriceBar(
        ticker=ticker,
        date=day,
        open=close,
        high=close + 1.0,
        low=close - 1.0,
        close=close,
        volume=volume,
    )


def _record(ticker: str, as_of: date) -> EligibilityRecord:
    return EligibilityRecord(
        ticker=ticker,
        median_dollar_volume=1e9,
        last_close=100.0,
        history_sessions=300,
        as_of=as_of,
    )


class _FakeHistorySource:
    """A PriceSource that serves per-ticker history -- the backfill path."""

    def __init__(self, histories: dict[str, list[PriceBar]]) -> None:
        self._histories = histories

    def fetch_history(self, ticker: str, from_date: date, to_date: date) -> list[PriceBar]:
        return list(self._histories.get(ticker, []))

    def fetch_exchange_day(self, exchange: str, day: date) -> list[PriceBar]:
        raise AssertionError("the backfill path must not call the bulk endpoint")


class _FakeBulkSource:
    """A PriceSource that serves one bulk-by-exchange day -- the nightly
    delta path. Publishes whatever the whole exchange returned, regardless
    of which tickers are eligible -- gating is the application layer's job,
    not the source's."""

    def __init__(self, sessions: dict[date, list[PriceBar]]) -> None:
        self._sessions = sessions

    def fetch_history(self, ticker: str, from_date: date, to_date: date) -> list[PriceBar]:
        raise AssertionError("the nightly delta must not call the per-ticker endpoint")

    def fetch_exchange_day(self, exchange: str, day: date) -> list[PriceBar]:
        return list(self._sessions.get(day, []))


class TestIngestFloor:
    def test_enforce_floor_drops_tickers_that_do_not_clear_it(self) -> None:
        rich = _history("RICH", days=300, close=100.0, volume=1_000_000)  # $100M/day
        thin = _history("THIN", days=300, close=100.0, volume=1_000)  # $100k/day
        source = _FakeHistorySource({"RICH": rich, "THIN": thin})
        store = InMemoryPanelStore()

        status = backfill_panel(
            source,
            store,
            ["RICH", "THIN"],
            FROM_DATE,
            TO_DATE,
            key=BACKFILL_PANEL_KEY,
            enforce_floor=True,
        )

        tickers = {bar.ticker for bar in parquet_bytes_to_bars(store.objects[BACKFILL_PANEL_KEY])}
        assert tickers == {"RICH"}, f"expected only RICH admitted, got {tickers}"
        assert (
            status.ticker_count == 1
        ), f"expected 1 ticker in the status, got {status.ticker_count}"

    def test_enforce_floor_writes_the_eligibility_object(self) -> None:
        rich = _history("RICH", days=300, close=100.0, volume=1_000_000)
        source = _FakeHistorySource({"RICH": rich})
        store = InMemoryPanelStore()

        backfill_panel(
            source, store, ["RICH"], FROM_DATE, TO_DATE, key=BACKFILL_PANEL_KEY, enforce_floor=True
        )

        assert ELIGIBILITY_KEY in store.objects, "expected the eligibility object to be written"
        eligible = eligibility_from_csv(store.objects[ELIGIBILITY_KEY].decode("utf-8"))
        assert set(eligible) == {"RICH"}, f"got {set(eligible)}"

    def test_enforce_floor_off_by_default_admits_every_fetched_ticker(self) -> None:
        # Pins today's default: an existing caller with a fixture too small
        # to ever clear the floor (a schema-conformance test, a rehearsal
        # run) keeps working unmodified.
        thin = _history("THIN", days=3, close=1.0, volume=10)
        source = _FakeHistorySource({"THIN": thin})
        store = InMemoryPanelStore()

        status = backfill_panel(source, store, ["THIN"], FROM_DATE, TO_DATE, key=BACKFILL_PANEL_KEY)

        assert status.ticker_count == 1, f"expected THIN admitted with the floor off: {status}"
        assert (
            ELIGIBILITY_KEY not in store.objects
        ), "the floor is off; no eligibility object expected"

    def test_enforce_floor_raises_and_does_not_overwrite_when_nothing_clears_it(self) -> None:
        thin = _history("THIN", days=3, close=1.0, volume=10)
        source = _FakeHistorySource({"THIN": thin})
        store = InMemoryPanelStore({BACKFILL_PANEL_KEY: b"existing-panel"})

        with pytest.raises(PriceSourceError):
            backfill_panel(
                source,
                store,
                ["THIN"],
                FROM_DATE,
                TO_DATE,
                key=BACKFILL_PANEL_KEY,
                enforce_floor=True,
            )

        assert store.objects[BACKFILL_PANEL_KEY] == b"existing-panel", "the panel was overwritten"


class TestNightlyDeltaGating:
    def test_an_off_universe_ticker_bar_is_never_admitted(self) -> None:
        rich_history = _history("RICH", days=300, close=100.0, volume=1_000_000)
        eligible = compute_eligible_universe(bars_to_panel(rich_history), as_of=TO_DATE)
        store = InMemoryPanelStore(
            {
                DELTA_PANEL_KEY: bars_to_parquet_bytes(rich_history),
                ELIGIBILITY_KEY: eligibility_to_csv(eligible).encode("utf-8"),
            }
        )
        new_day = START + timedelta(days=300)
        source = _FakeBulkSource(
            {
                new_day: [
                    _bar("RICH", new_day, 101.0, 1_000_000),
                    _bar("ZZZZ", new_day, 50.0, 5_000_000),  # never seen before, off-universe
                ]
            }
        )

        status = append_daily_delta(source, store, "US", new_day, key=DELTA_PANEL_KEY)

        frame = parquet_bytes_to_panel(store.objects[DELTA_PANEL_KEY])
        tickers = set(frame["ticker"].astype(str))
        assert "ZZZZ" not in tickers, f"an off-universe ticker was admitted: {tickers}"
        assert (
            status.ticker_count == 1
        ), f"expected only RICH in the panel, got {status.ticker_count}"

    def test_without_an_eligibility_object_every_ticker_is_admitted(self) -> None:
        # AC2's fallback: a store that has never had the floor enforced
        # keeps today's unfiltered behavior, with zero edits required.
        existing = bars_to_parquet_bytes(_history("RICH", days=5, close=100.0, volume=1_000_000))
        store = InMemoryPanelStore({DELTA_PANEL_KEY: existing})
        new_day = START + timedelta(days=5)
        source = _FakeBulkSource({new_day: [_bar("ANYTHING", new_day, 5.0, 10)]})

        append_daily_delta(source, store, "US", new_day, key=DELTA_PANEL_KEY)

        frame = parquet_bytes_to_panel(store.objects[DELTA_PANEL_KEY])
        tickers = set(frame["ticker"].astype(str))
        assert "ANYTHING" in tickers, f"expected the unfiltered fallback to admit it, got {tickers}"


class TestDemotionAndPromotionPolicy:
    def test_a_demoted_ticker_freezes_next_run_but_keeps_its_prior_history(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        rich = _history("RICH", days=300, close=100.0, volume=1_000_000)  # always $100M/day
        # FADE's most recent 60 sessions already sit under the floor in the
        # *existing* stored panel, before tonight's run -- tonight's refresh
        # reads the panel, not a single night's bar.
        fade = _history("FADE", days=240, close=100.0, volume=1_000_000) + _history(
            "FADE", days=60, close=100.0, volume=1_000, start=START + timedelta(days=240)
        )
        existing = bars_to_parquet_bytes(rich + fade)
        as_of = START + timedelta(days=299)
        seeded = {"RICH": _record("RICH", as_of), "FADE": _record("FADE", as_of)}
        store = InMemoryPanelStore(
            {
                DELTA_PANEL_KEY: existing,
                ELIGIBILITY_KEY: eligibility_to_csv(seeded).encode("utf-8"),
            }
        )
        night1 = START + timedelta(days=300)
        source1 = _FakeBulkSource(
            {night1: [_bar("RICH", night1, 101.0, 1_000_000), _bar("FADE", night1, 99.0, 1_000)]}
        )

        with caplog.at_level(logging.WARNING, logger="application.append_daily_delta"):
            append_daily_delta(source1, store, "US", night1, key=DELTA_PANEL_KEY)

        refreshed = eligibility_from_csv(store.objects[ELIGIBILITY_KEY].decode("utf-8"))
        assert set(refreshed) == {
            "RICH"
        }, f"expected FADE demoted, eligible set is {set(refreshed)}"
        assert any(
            "FADE" in record.message for record in caplog.records
        ), f"expected the demotion to be logged, got {[r.message for r in caplog.records]}"

        frame_after_night1 = parquet_bytes_to_panel(store.objects[DELTA_PANEL_KEY])
        assert "FADE" in set(
            frame_after_night1["ticker"].astype(str)
        ), "a demoted ticker's existing history must not be retroactively deleted"
        fade_rows_after_night1 = int((frame_after_night1["ticker"] == "FADE").sum())

        # Night 2: FADE offers a strong bar, but the gate reads last night's
        # refreshed set, which no longer names it -- it stays frozen.
        night2 = night1 + timedelta(days=1)
        source2 = _FakeBulkSource(
            {
                night2: [
                    _bar("RICH", night2, 102.0, 1_000_000),
                    _bar("FADE", night2, 500.0, 10_000_000),
                ]
            }
        )

        append_daily_delta(source2, store, "US", night2, key=DELTA_PANEL_KEY)

        frame_after_night2 = parquet_bytes_to_panel(store.objects[DELTA_PANEL_KEY])
        fade_rows_after_night2 = int((frame_after_night2["ticker"] == "FADE").sum())
        assert fade_rows_after_night2 == fade_rows_after_night1, (
            f"a demoted ticker must stay frozen even on a strong night: "
            f"{fade_rows_after_night1} -> {fade_rows_after_night2}"
        )
        rich_rows_after_night2 = int((frame_after_night2["ticker"] == "RICH").sum())
        assert (
            rich_rows_after_night2 == 302
        ), f"expected RICH's two new bars merged, got {rich_rows_after_night2}"
