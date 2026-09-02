from datetime import date

from domain.backtest_stats import (
    aggregate_drawdowns,
    max_drawdown,
    rebalance_dates,
    summarize_returns,
)


class TestSummarizeReturns:
    def test_empty_input_yields_zero_count_distribution(self) -> None:
        result = summarize_returns([], horizon_days=5)

        assert result.count == 0, f"expected zero count for empty input, got {result.count}"
        assert (
            result.horizon_days == 5
        ), f"expected horizon_days echoed as 5, got {result.horizon_days}"
        assert (
            result.hit_rate == 0.0
        ), f"expected hit_rate 0.0 for empty input, got {result.hit_rate}"

    def test_all_losers_reports_zero_hit_rate(self) -> None:
        result = summarize_returns([-0.1, -0.2, -0.05], horizon_days=5)

        assert result.count == 3, f"expected count 3, got {result.count}"
        assert (
            result.hit_rate == 0.0
        ), f"expected hit_rate 0.0 for all losers, got {result.hit_rate}"
        assert result.worst == -0.2, f"expected worst -0.2, got {result.worst}"
        assert result.best == -0.05, f"expected best -0.05, got {result.best}"

    def test_mixed_returns_computes_hand_checked_stats(self) -> None:
        # mean = (0.10 - 0.20 + 0.30) / 3 = 0.0666...; median = 0.10;
        # hit_rate = 2/3 (two positive of three)
        result = summarize_returns([0.10, -0.20, 0.30], horizon_days=10)

        assert result.count == 3, f"expected count 3, got {result.count}"
        assert abs(result.mean - (0.20 / 3)) < 1e-9, f"expected mean ~0.0667, got {result.mean}"
        assert result.median == 0.10, f"expected median 0.10, got {result.median}"
        assert (
            abs(result.hit_rate - (2 / 3)) < 1e-9
        ), f"expected hit_rate 2/3, got {result.hit_rate}"


class TestMaxDrawdown:
    def test_single_point_has_no_drawdown(self) -> None:
        assert max_drawdown([100.0]) == 0.0, "a single-point path has no trough to measure"

    def test_monotonically_rising_path_has_zero_drawdown(self) -> None:
        assert max_drawdown([100.0, 110.0, 120.0]) == 0.0, "a path that only rises has no drawdown"

    def test_known_peak_to_trough_decline(self) -> None:
        # Peak 120 at index 1, trough 90 at index 3: (90 - 120) / 120 = -0.25
        result = max_drawdown([100.0, 120.0, 110.0, 90.0, 95.0])

        assert abs(result - (-0.25)) < 1e-9, f"expected -0.25 max drawdown, got {result}"

    def test_recovers_before_a_deeper_second_decline(self) -> None:
        # Peak 100 -> trough 50 (-0.50); recovers to 200 -> trough 180 (-0.10).
        # The deepest drawdown, -0.50, must be the one reported.
        result = max_drawdown([100.0, 50.0, 200.0, 180.0])

        assert abs(result - (-0.50)) < 1e-9, f"expected worst drawdown -0.50, got {result}"


class TestAggregateDrawdowns:
    def test_empty_input_yields_zero_stats(self) -> None:
        result = aggregate_drawdowns([])

        assert result.count == 0, f"expected count 0, got {result.count}"
        assert result.worst_max_drawdown == 0.0, f"expected 0.0, got {result.worst_max_drawdown}"

    def test_aggregates_mean_median_and_worst(self) -> None:
        result = aggregate_drawdowns([-0.10, -0.30, -0.20])

        assert result.count == 3, f"expected count 3, got {result.count}"
        assert (
            abs(result.mean_max_drawdown - (-0.20)) < 1e-9
        ), f"expected mean -0.20, got {result.mean_max_drawdown}"
        assert (
            result.median_max_drawdown == -0.20
        ), f"expected median -0.20, got {result.median_max_drawdown}"
        assert (
            result.worst_max_drawdown == -0.30
        ), f"expected worst -0.30, got {result.worst_max_drawdown}"


class TestRebalanceDates:
    _SESSIONS = [date(2024, 1, d) for d in (1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 15, 16)]

    def test_daily_keeps_every_session_in_range(self) -> None:
        result = rebalance_dates(date(2024, 1, 1), date(2024, 1, 5), "daily", self._SESSIONS)

        assert result == [
            date(2024, 1, d) for d in (1, 2, 3, 4, 5)
        ], f"expected all 5 January sessions kept for daily, got {result}"

    def test_weekly_keeps_last_session_per_iso_week(self) -> None:
        result = rebalance_dates(date(2024, 1, 1), date(2024, 1, 16), "weekly", self._SESSIONS)

        # Jan 1-5 is ISO week 1 (last session Jan 5); Jan 8-12 is week 2
        # (last session Jan 12); Jan 15-16 is week 3 (last session so far Jan 16).
        assert result == [
            date(2024, 1, 5),
            date(2024, 1, 12),
            date(2024, 1, 16),
        ], f"expected one date per ISO week, got {result}"

    def test_monthly_keeps_last_session_of_the_month(self) -> None:
        result = rebalance_dates(date(2024, 1, 1), date(2024, 1, 16), "monthly", self._SESSIONS)

        assert result == [
            date(2024, 1, 16)
        ], f"expected only the latest January session, got {result}"

    def test_filters_sessions_outside_the_requested_range(self) -> None:
        result = rebalance_dates(date(2024, 1, 3), date(2024, 1, 9), "daily", self._SESSIONS)

        assert result == [
            date(2024, 1, d) for d in (3, 4, 5, 8, 9)
        ], f"expected only sessions within [Jan 3, Jan 9], got {result}"
