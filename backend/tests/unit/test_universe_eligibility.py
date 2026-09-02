"""T-0016-13: infra/universe_eligibility.py -- measuring a panel's tickers
against the enforced floor (domain/universe_floor.py) and round-tripping
the result as a stored CSV.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from domain.models.price import PriceBar
from infra.panel_frame import bars_to_panel
from infra.universe_eligibility import (
    compute_eligible_universe,
    eligibility_from_csv,
    eligibility_to_csv,
)

START = date(2024, 1, 1)
AS_OF = START + timedelta(days=299)


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


class TestComputeEligibleUniverse:
    def test_a_ticker_clearing_all_three_floors_is_admitted(self) -> None:
        frame = bars_to_panel(_history("RICH", days=300, close=100.0, volume=1_000_000))

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert "RICH" in eligible, f"expected RICH admitted, got {sorted(eligible)}"
        record = eligible["RICH"]
        assert record.median_dollar_volume == pytest.approx(100_000_000.0), record
        assert record.history_sessions == 300, record
        assert record.as_of == AS_OF, record

    def test_a_ticker_with_low_dollar_volume_is_excluded(self) -> None:
        frame = bars_to_panel(_history("THIN", days=300, close=100.0, volume=1_000))

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert "THIN" not in eligible, f"expected THIN excluded, got {sorted(eligible)}"

    def test_a_ticker_with_short_history_is_excluded(self) -> None:
        frame = bars_to_panel(_history("NEW", days=100, close=100.0, volume=1_000_000))

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert (
            "NEW" not in eligible
        ), f"expected NEW excluded (100 sessions), got {sorted(eligible)}"

    def test_a_ticker_below_the_price_floor_is_excluded(self) -> None:
        frame = bars_to_panel(_history("PENNY", days=300, close=0.50, volume=100_000_000))

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert (
            "PENNY" not in eligible
        ), f"expected PENNY excluded (close $0.50), got {sorted(eligible)}"

    def test_the_window_is_market_wide_not_per_ticker(self) -> None:
        # A ticker whose own trading stopped well before the panel's most
        # recent 60-session window still had plenty of history and volume
        # while it traded, but reports no dollar volume in *this* window
        # rather than a stale median from that history.
        stale = _history(
            "STALE", days=300, close=100.0, volume=1_000_000, start=START - timedelta(days=300)
        )
        fresh = _history("FRESH", days=300, close=100.0, volume=1_000_000, start=START)
        frame = bars_to_panel(stale + fresh)

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert (
            "STALE" not in eligible
        ), f"expected STALE excluded (no rows in the recent window), got {sorted(eligible)}"
        assert "FRESH" in eligible, f"expected FRESH admitted, got {sorted(eligible)}"

    def test_an_empty_frame_admits_nothing(self) -> None:
        frame = bars_to_panel([])

        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        assert eligible == {}, f"expected no eligible tickers from an empty frame, got {eligible}"


class TestEligibilityCsvRoundTrip:
    def test_round_trip_preserves_every_field(self) -> None:
        frame = bars_to_panel(_history("RICH", days=300, close=100.0, volume=1_000_000))
        eligible = compute_eligible_universe(frame, as_of=AS_OF)

        restored = eligibility_from_csv(eligibility_to_csv(eligible))

        assert restored == eligible, f"round trip changed the record: {restored} != {eligible}"

    def test_an_empty_set_round_trips_to_an_empty_set(self) -> None:
        restored = eligibility_from_csv(eligibility_to_csv({}))

        assert restored == {}, f"expected an empty set, got {restored}"
