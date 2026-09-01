from datetime import date, timedelta

import pytest

from domain.errors import ExpressionError
from domain.models.pattern import SetupStep
from domain.models.price import PriceBar
from domain.models.universe import TickerMetadata
from infra.pandas_engine import PandasPatternResearchEngine
from scripts.generate_mock_panel import generate_panel
from scripts.known_pattern_instances import KNOWN_PATTERN_INSTANCES

# These tests target the real pandas-based PatternResearchEngine
# implementation (built in this ticket), not MockPatternResearchEngine —
# the whole point is verifying real temporal-matching correctness against
# T-0001-1's known fixture instances. The mock is for other tickets'
# callers (e.g. T-0001-5) that just need a stand-in dependency.

# The setup config that must reproduce every known "gap up -> range
# contraction -> breakout" fixture from known_pattern_instances.py exactly:
#   step 0 (anchor): a >=5% opening gap over the prior close.
#   step 1 (sustained, days 2-4 after the gap): each day's high-low range
#     narrower than the immediately preceding day's — this is exactly the
#     "narrows day over day" property asserted by
#     test_generate_mock_panel.py, deliberately skipping day 1 (which is a
#     volatility spike relative to the gap day, not part of the narrowing).
#   step 2 (1 day after the narrowing window resolves): a close breaking
#     above the highest high of the preceding 4 days (the contraction
#     window), landing exactly on the known breakout_date.
GAP_CONTRACTION_BREAKOUT_STEPS = [
    SetupStep(condition="open >= highest(close, 1) * 1.05"),
    SetupStep(condition="(high - low) < highest(high - low, 1)", within=(2, 4), sustained=True),
    SetupStep(condition="close > highest(high, 4)", within=(1, 1)),
]


def _bar(ticker: str, day: date, close: float, volume: int = 1_000_000) -> PriceBar:
    """A simple bar with a fixed +/-1 high/low band around `close` — enough
    for tests whose conditions only reference open/close/volume directly."""
    return PriceBar(
        ticker=ticker,
        date=day,
        open=close,
        high=close + 1,
        low=close - 1,
        close=close,
        volume=volume,
    )


def _sequential_bars(
    ticker: str, closes: list[float], start: date = date(2024, 1, 1)
) -> list[PriceBar]:
    return [_bar(ticker, start + timedelta(days=i), close) for i, close in enumerate(closes)]


def _mock_panel_engine() -> PandasPatternResearchEngine:
    return PandasPatternResearchEngine.from_price_bars(generate_panel())


class TestStudyDefinition:
    def test_define_study_with_valid_expression_returns_referenceable_study(self) -> None:
        # volumes chosen so rel_vol = volume / sma(volume, 3) only clears 1.5
        # on day 3 (400 / mean(100, 100, 100) = 1.0 on day 2, then
        # 400 / mean(100, 100, 400) = 2.0 on day 3), a concrete, hand-checked
        # end-to-end proof the study is actually usable by name, not just
        # stored as an opaque string.
        bars = _sequential_bars("STUDY1", [100, 100, 100, 400])
        for bar, vol in zip(bars, [100, 100, 100, 400]):
            bar.volume = vol
        engine = PandasPatternResearchEngine.from_price_bars(bars)

        study = engine.define_study("rel_vol", "volume / sma(volume, 3)")

        assert study.name == "rel_vol", f"expected study name 'rel_vol', got {study.name}"
        assert (
            study.expression == "volume / sma(volume, 3)"
        ), f"expected the stored expression to match verbatim, got {study.expression}"
        assert study.id, "expected define_study to assign a non-empty id"

        # Referenceable by name in a setup's condition (AC1).
        setup = engine.define_setup("above_avg_vol", [SetupStep(condition="rel_vol > 1.5")])
        result = engine.find_instances(setup)

        assert result.complete_count == 1, (
            f"expected exactly 1 day where rel_vol > 1.5, got {result.complete_count}: "
            f"{result.instances}"
        )
        assert result.instances[0].date == bars[-1].date, (
            f"expected the match on {bars[-1].date} (the volume spike day), "
            f"got {result.instances[0].date}"
        )

    def test_define_study_with_unsupported_function_raises_expression_error_with_catalog(
        self,
    ) -> None:
        engine = _mock_panel_engine()

        with pytest.raises(ExpressionError) as exc_info:
            engine.define_study("bad", "vwap(close, 10)")

        error = exc_info.value
        assert "vwap" in str(error), f"expected the error to name the bad function, got {error}"
        assert error.catalog == ["sma", "ema", "atr", "highest", "lowest", "days_since"], (
            f"expected the full supported-function catalog on the error so a caller can "
            f"self-correct in one turn, got {error.catalog}"
        )


class TestSetupDefinition:
    def test_define_setup_with_windowed_steps_returns_searchable_setup(self) -> None:
        engine = _mock_panel_engine()
        steps = [
            SetupStep(condition="open >= highest(close, 1) * 1.05"),
            SetupStep(condition="close > highest(high, 4)", within=(1, 5)),
        ]

        setup = engine.define_setup("gap_then_breakout", steps)

        assert setup.name == "gap_then_breakout", f"expected name preserved, got {setup.name}"
        assert setup.steps == steps, f"expected steps preserved verbatim, got {setup.steps}"
        assert setup.id, "expected define_setup to assign a non-empty id"

        # "becomes searchable via instance search" (spec.md) — this must not raise.
        result = engine.find_instances(setup)
        assert (
            result.setup_id == setup.id
        ), f"expected the result to reference {setup.id}, got {result.setup_id}"

    def test_find_instances_sustained_step_requires_condition_every_day_of_window(self) -> None:
        # SUS_A: volume stays >500_000 on every day of the (1,3) window ->
        # sustained step resolves. SUS_B: volume dips below the threshold on
        # day 2 of the window -> sustained step must fail even though it
        # holds on the other two days.
        bars = []
        bars += [_bar("SUS_A", date(2024, 1, 1), 101)]
        bars += [
            PriceBar(
                ticker="SUS_A",
                date=date(2024, 1, 1) + timedelta(days=i),
                open=50,
                high=51,
                low=49,
                close=50,
                volume=600_000,
            )
            for i in (1, 2, 3)
        ]
        bars += [_bar("SUS_B", date(2024, 1, 1), 101)]
        for i, vol in zip((1, 2, 3), (600_000, 300_000, 600_000)):
            bars.append(
                PriceBar(
                    ticker="SUS_B",
                    date=date(2024, 1, 1) + timedelta(days=i),
                    open=50,
                    high=51,
                    low=49,
                    close=50,
                    volume=vol,
                )
            )
        engine = PandasPatternResearchEngine.from_price_bars(bars)
        setup = engine.define_setup(
            "sustained_volume",
            [
                SetupStep(condition="close > 100"),
                SetupStep(condition="volume > 500000", within=(1, 3), sustained=True),
            ],
        )

        result = engine.find_instances(setup)

        tickers_matched = {inst.ticker for inst in result.instances if inst.completeness == 1.0}
        assert tickers_matched == {"SUS_A"}, (
            f"expected only SUS_A (condition true every day of the window) to complete, "
            f"got {tickers_matched}"
        )


class TestInstanceSearch:
    def test_find_instances_returns_known_completed_matches_with_count_and_date_range(
        self,
    ) -> None:
        engine = _mock_panel_engine()
        setup = engine.define_setup("gcb", GAP_CONTRACTION_BREAKOUT_STEPS)

        result = engine.find_instances(setup)

        assert result.complete_count == len(KNOWN_PATTERN_INSTANCES), (
            f"expected {len(KNOWN_PATTERN_INSTANCES)} completed matches, "
            f"got {result.complete_count}: {result.instances}"
        )
        assert result.from_date == date(2023, 1, 3), (
            f"expected the reported range to start at the panel's first date, "
            f"got {result.from_date}"
        )
        assert result.to_date == date(
            2025, 12, 31
        ), f"expected the reported range to end at the panel's last date, got {result.to_date}"

    def test_find_instances_matches_exactly_the_known_fixture_instances_no_more_no_less(
        self,
    ) -> None:
        engine = _mock_panel_engine()
        setup = engine.define_setup("gcb", GAP_CONTRACTION_BREAKOUT_STEPS)

        result = engine.find_instances(setup)

        actual = {(inst.ticker, inst.date) for inst in result.instances if inst.completeness == 1.0}
        expected = {(k.ticker, k.breakout_date) for k in KNOWN_PATTERN_INSTANCES}
        assert actual == expected, (
            f"expected the matcher to find exactly the known fixture instances "
            f"({sorted(expected)}) with no false positives or negatives, got {sorted(actual)}"
        )

    def test_find_instances_includes_partial_matches_when_completed_count_below_five(
        self,
    ) -> None:
        # Anchor (close > 200) and confirmation (close > 100) use different
        # thresholds so a confirmation day is never itself mistaken for a
        # second anchor.
        # COMPLETE_1/2: resolve step 1 within its window -> 2 completed
        # matches (< 5, so the fallback should kick in).
        # PARTIAL_1: satisfies the anchor but has no further data at all, so
        # step 1's window isn't covered yet -> a partial with completeness
        # 1/2 (1 of 2 steps satisfied).
        # FAILS: has the anchor, then decisively fails step 1 (full window
        # available, condition never true) -> must NOT show up as partial.
        bars = []
        bars += _sequential_bars("COMPLETE_1", [201, 101])
        bars += _sequential_bars("COMPLETE_2", [201, 101])
        bars += [_bar("PARTIAL_1", date(2024, 1, 1), 201)]
        bars += _sequential_bars("FAILS", [201, 50, 50])
        engine = PandasPatternResearchEngine.from_price_bars(bars)
        setup = engine.define_setup(
            "anchor_then_confirm",
            [
                SetupStep(condition="close > 200"),
                SetupStep(condition="close > 100", within=(1, 2)),
            ],
        )

        result = engine.find_instances(setup)

        assert (
            result.complete_count == 2
        ), f"expected 2 completed matches, got {result.complete_count}: {result.instances}"
        assert result.partial_count == 1, (
            f"expected 1 partial match surfaced (fallback triggers below 5 completed), "
            f"got {result.partial_count}: {result.instances}"
        )
        partials = [inst for inst in result.instances if inst.completeness < 1.0]
        assert len(partials) == 1, f"expected exactly 1 partial instance, got {partials}"
        partial = partials[0]
        assert partial.ticker == "PARTIAL_1", f"expected PARTIAL_1 to be the partial, got {partial}"
        assert partial.completeness == pytest.approx(
            0.5
        ), f"expected completeness 1/2 (1 of 2 steps satisfied), got {partial.completeness}"
        assert "FAILS" not in {
            inst.ticker for inst in result.instances
        }, "a decisive failure must never be reported as a partial match"

    def test_find_instances_counts_repeated_occurrences_as_separate_instances(self) -> None:
        # Anchor threshold (close > 200) fires twice for this ticker, each
        # independently confirmed by a later day closing > 100 — two
        # non-overlapping completions of the same setup on the same ticker.
        bars = [
            _bar("REPEAT", date(2024, 1, 1), 201),  # anchor 1
            _bar("REPEAT", date(2024, 1, 2), 101),  # confirms anchor 1
            _bar("REPEAT", date(2024, 1, 3), 50),  # neither anchor nor confirmation
            _bar("REPEAT", date(2024, 1, 4), 201),  # anchor 2
            _bar("REPEAT", date(2024, 1, 5), 101),  # confirms anchor 2
        ]
        engine = PandasPatternResearchEngine.from_price_bars(bars)
        setup = engine.define_setup(
            "repeat",
            [
                SetupStep(condition="close > 200"),
                SetupStep(condition="close > 100", within=(1, 2)),
            ],
        )

        result = engine.find_instances(setup)

        repeat_instances = sorted(
            (inst for inst in result.instances if inst.ticker == "REPEAT"), key=lambda i: i.date
        )
        assert len(repeat_instances) == 2, (
            f"expected 2 separate instances (repeated occurrences are not deduplicated), "
            f"got {len(repeat_instances)}: {repeat_instances}"
        )
        assert [inst.date for inst in repeat_instances] == [
            date(2024, 1, 2),
            date(2024, 1, 5),
        ], f"expected the two independent completions on 1/2 and 1/5, got {repeat_instances}"

    def test_find_instances_counts_earliest_valid_completion_only_for_one_start(self) -> None:
        # The window (1,3) after the anchor has THREE days that could each
        # independently resolve the confirming step — only the earliest
        # (day 1) may count, not three separate instances.
        bars = [
            _bar("REDUNDANT", date(2024, 1, 1), 201),  # anchor
            _bar("REDUNDANT", date(2024, 1, 2), 101),  # earliest valid completion
            _bar("REDUNDANT", date(2024, 1, 3), 101),  # would also satisfy the step
            _bar("REDUNDANT", date(2024, 1, 4), 101),  # would also satisfy the step
        ]
        engine = PandasPatternResearchEngine.from_price_bars(bars)
        setup = engine.define_setup(
            "redundant",
            [
                SetupStep(condition="close > 200"),
                SetupStep(condition="close > 100", within=(1, 3)),
            ],
        )

        result = engine.find_instances(setup)

        redundant_instances = [inst for inst in result.instances if inst.ticker == "REDUNDANT"]
        assert len(redundant_instances) == 1, (
            f"expected exactly 1 instance for this single start (not 3), "
            f"got {len(redundant_instances)}: {redundant_instances}"
        )
        assert redundant_instances[0].date == date(
            2024, 1, 2
        ), f"expected the earliest valid completion (1/2), got {redundant_instances[0].date}"

    def test_find_instances_respects_date_range_and_universe_filters(self) -> None:
        anchor_day = date(2024, 6, 1)
        bars = [
            _bar("BIGCAP", anchor_day, 101),
            _bar("BIGCAP", anchor_day + timedelta(days=1), 50),
            _bar("SMALLCAP", anchor_day, 101),
            _bar("SMALLCAP", anchor_day + timedelta(days=1), 50),
        ]
        universe = {
            "BIGCAP": TickerMetadata(
                ticker="BIGCAP", sector="Tech", market_cap=5_000_000_000, as_of=anchor_day
            ),
            "SMALLCAP": TickerMetadata(
                ticker="SMALLCAP", sector="Energy", market_cap=1_000_000, as_of=anchor_day
            ),
        }
        engine = PandasPatternResearchEngine.from_price_bars(bars, universe=universe)
        # Single-step setup: resolves immediately at the anchor day, so
        # market cap / sector / date-range filtering is what's under test,
        # not multi-step temporal logic.
        setup = engine.define_setup("single_step", [SetupStep(condition="close > 100")])

        by_cap = engine.find_instances(setup, min_market_cap=1_000_000_000)
        assert {inst.ticker for inst in by_cap.instances} == {
            "BIGCAP"
        }, f"expected only BIGCAP to survive the market cap filter, got {by_cap.instances}"

        by_sector = engine.find_instances(setup, sectors=["Energy"])
        assert {inst.ticker for inst in by_sector.instances} == {
            "SMALLCAP"
        }, f"expected only SMALLCAP to survive the sector filter, got {by_sector.instances}"

        out_of_range = engine.find_instances(setup, from_date=anchor_day + timedelta(days=1))
        assert out_of_range.complete_count == 0, (
            f"expected no matches once the anchor day is excluded by from_date, "
            f"got {out_of_range.instances}"
        )
        in_range = engine.find_instances(setup, from_date=anchor_day, to_date=anchor_day)
        assert {inst.ticker for inst in in_range.instances} == {
            "BIGCAP",
            "SMALLCAP",
        }, f"expected both tickers within the exact anchor-day range, got {in_range.instances}"
