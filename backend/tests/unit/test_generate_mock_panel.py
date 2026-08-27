from datetime import date

from scripts.generate_mock_panel import TICKERS, generate_panel
from scripts.known_pattern_instances import KNOWN_PATTERN_INSTANCES


def _bars_by_date(bars, ticker: str) -> dict[date, object]:
    return {bar.date: bar for bar in bars if bar.ticker == ticker}


class TestMockPanelGenerator:
    def test_generate_panel_returns_price_bars_for_all_tickers(self) -> None:
        bars = generate_panel()

        tickers_present = {bar.ticker for bar in bars}
        assert tickers_present == set(
            TICKERS
        ), f"expected bars for {sorted(TICKERS)}, got tickers {sorted(tickers_present)}"

        for ticker in TICKERS:
            ticker_bars = [b for b in bars if b.ticker == ticker]
            years_covered = {b.date.year for b in ticker_bars}
            assert (
                len(years_covered) >= 2
            ), f"expected {ticker} to span multiple years, got years {sorted(years_covered)}"
            for bar in ticker_bars:
                assert (
                    bar.low <= min(bar.open, bar.close) <= max(bar.open, bar.close) <= bar.high
                ), (
                    f"invalid OHLC ordering for {ticker} on {bar.date}: "
                    f"open={bar.open} high={bar.high} low={bar.low} close={bar.close}"
                )
                assert bar.volume > 0, f"expected positive volume for {ticker} on {bar.date}"
        assert bars, "expected at least one bar"

    def test_generate_panel_includes_known_gap_contraction_breakout_instance(self) -> None:
        bars = generate_panel()
        instance = KNOWN_PATTERN_INSTANCES[0]
        by_date = _bars_by_date(bars, instance.ticker)

        prior_idx = sorted(by_date).index(instance.gap_date) - 1
        prior_close = by_date[sorted(by_date)[prior_idx]].close

        gap_bar = by_date[instance.gap_date]
        assert gap_bar.open >= prior_close * 1.05, (
            f"expected a >=5% gap up on {instance.gap_date}, "
            f"prior close={prior_close}, gap open={gap_bar.open}"
        )

        contraction_ranges = [by_date[d].high - by_date[d].low for d in instance.contraction_dates]
        assert contraction_ranges == sorted(contraction_ranges, reverse=True), (
            f"expected strictly narrowing daily ranges across {instance.contraction_dates}, "
            f"got ranges {contraction_ranges}"
        )
        for earlier, later in zip(contraction_ranges, contraction_ranges[1:]):
            assert later < earlier, (
                f"expected each contraction day's range to be smaller than the last, "
                f"got {contraction_ranges}"
            )

        breakout_bar = by_date[instance.breakout_date]
        max_contraction_high = max(by_date[d].high for d in instance.contraction_dates)
        assert breakout_bar.close > max_contraction_high, (
            f"expected breakout close ({breakout_bar.close}) on {instance.breakout_date} to "
            f"exceed the contraction window's highest high ({max_contraction_high})"
        )

    def test_generate_panel_includes_multiple_known_pattern_instances(self) -> None:
        assert (
            len(KNOWN_PATTERN_INSTANCES) >= 3
        ), f"expected at least 3 known pattern instances, got {len(KNOWN_PATTERN_INSTANCES)}"
        distinct_tickers = {i.ticker for i in KNOWN_PATTERN_INSTANCES}
        assert (
            len(distinct_tickers) >= 3
        ), f"expected known instances on at least 3 distinct tickers, got {distinct_tickers}"

        bars = generate_panel()
        for instance in KNOWN_PATTERN_INSTANCES:
            by_date = _bars_by_date(bars, instance.ticker)
            all_dates = [instance.gap_date, *instance.contraction_dates, instance.breakout_date]
            for d in all_dates:
                assert (
                    d in by_date
                ), f"expected a bar for {instance.ticker} on {d} (known pattern instance)"

            gap_bar = by_date[instance.gap_date]
            breakout_bar = by_date[instance.breakout_date]
            max_contraction_high = max(by_date[d].high for d in instance.contraction_dates)
            assert breakout_bar.close > max_contraction_high, (
                f"instance {instance.ticker}/{instance.gap_date}: breakout close "
                f"({breakout_bar.close}) should exceed contraction high ({max_contraction_high})"
            )
            assert (
                gap_bar.open > gap_bar.low
            ), f"instance {instance.ticker}/{instance.gap_date}: malformed gap bar {gap_bar}"

    def test_generate_panel_with_fixed_seed_is_reproducible(self) -> None:
        first_run = generate_panel(seed=42)
        second_run = generate_panel(seed=42)

        assert (
            first_run == second_run
        ), "expected generate_panel(seed=42) to produce identical output across runs"

        different_seed_run = generate_panel(seed=43)
        assert (
            first_run != different_seed_run
        ), "expected a different seed to produce different baseline data"
