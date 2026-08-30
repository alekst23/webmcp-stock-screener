from datetime import date

import pytest

from domain.models.instance import Instance, InstanceSet
from infra.pandas_engine import PandasPatternResearchEngine
from scripts.generate_mock_panel import generate_panel
from scripts.known_pattern_instances import KNOWN_PATTERN_INSTANCES

# Target the real pandas-based PatternResearchEngine implementation, not
# MockPatternResearchEngine — verifying real computed statistics against
# T-1001-1's known fixture outcomes is the point of this suite.

# Hand-computed (see T-1001-4's report) forward returns of each known
# fixture instance's breakout_date over a 5-trading-day horizon, straight
# from the mock panel's close prices. All three happen to be losers in this
# seeded panel (the random walk after the hand-authored pattern days has no
# engineered drift), which is why splitting tests below use a threshold /
# condition rather than the default (0.0) outcome split to exercise both
# groups.
_KNOWN_FORWARD_RETURNS_H5 = {
    "MOCK01": pytest.approx(-0.16550648715309274),
    "MOCK02": pytest.approx(-0.12760939753602457),
    "MOCK03": pytest.approx(-0.16909628629147289),
}


def _mock_panel_engine() -> PandasPatternResearchEngine:
    return PandasPatternResearchEngine.from_price_bars(generate_panel())


def _known_instances() -> list[Instance]:
    return [
        Instance(ticker=k.ticker, date=k.breakout_date, completeness=1.0)
        for k in KNOWN_PATTERN_INSTANCES
    ]


def _instance_set(instances: list[Instance], **overrides: object) -> InstanceSet:
    dates = [inst.date for inst in instances]
    defaults: dict[str, object] = dict(
        id="set_test",
        setup_id="setup_test",
        instances=instances,
        complete_count=sum(1 for i in instances if i.completeness >= 1.0),
        partial_count=sum(1 for i in instances if i.completeness < 1.0),
        from_date=min(dates),
        to_date=max(dates),
    )
    defaults.update(overrides)
    return InstanceSet(**defaults)  # type: ignore[arg-type]


class TestInstanceSampling:
    def test_sample_instances_recent_strategy_returns_requested_count(self) -> None:
        engine = _mock_panel_engine()
        instance_set = _instance_set(_known_instances())

        sampled = engine.sample_instances(instance_set, n=2, strategy="recent")

        assert len(sampled) == 2, f"expected exactly 2 sampled instances, got {len(sampled)}"
        assert [inst.ticker for inst in sampled] == ["MOCK03", "MOCK02"], (
            f"expected the 2 most recent instances (MOCK03 2025-01-20, then MOCK02 2024-03-11) "
            f"in descending date order, got {[(i.ticker, i.date) for i in sampled]}"
        )

    def test_sample_instances_best_strategy_ranks_by_forward_return(self) -> None:
        # Known h=5 returns: MOCK02 -12.76% (best/least negative), MOCK01
        # -16.55%, MOCK03 -16.91% (worst) — see _KNOWN_FORWARD_RETURNS_H5.
        engine = _mock_panel_engine()
        instance_set = _instance_set(_known_instances())

        best = engine.sample_instances(instance_set, n=3, strategy="best", horizon_days=5)
        worst = engine.sample_instances(instance_set, n=3, strategy="worst", horizon_days=5)

        assert [inst.ticker for inst in best] == ["MOCK02", "MOCK01", "MOCK03"], (
            f"expected best-to-worst forward-return order, got {[i.ticker for i in best]}"
        )
        assert [inst.ticker for inst in worst] == ["MOCK03", "MOCK01", "MOCK02"], (
            f"expected worst-to-best forward-return order, got {[i.ticker for i in worst]}"
        )

        with pytest.raises(ValueError):
            engine.sample_instances(instance_set, strategy="best")  # missing horizon_days


class TestOutcomeMeasurement:
    def test_measure_computes_summary_statistics_for_known_instances(self) -> None:
        engine = _mock_panel_engine()
        instance_set = _instance_set(_known_instances())
        returns = [
            _KNOWN_FORWARD_RETURNS_H5[k.ticker].expected for k in KNOWN_PATTERN_INSTANCES
        ]

        result = engine.measure(instance_set, horizon_days=5, compare_to_base_rate=False)

        assert result.count == 3, f"expected all 3 known instances measured, got {result.count}"
        assert result.median == pytest.approx(sorted(returns)[1]), (
            f"expected the median of the 3 known forward returns, got {result.median}"
        )
        assert result.mean == pytest.approx(sum(returns) / len(returns)), (
            f"expected the mean of the 3 known forward returns, got {result.mean}"
        )
        assert result.hit_rate == pytest.approx(0.0), (
            f"expected hit_rate 0.0 (all 3 known instances are losers at h=5), "
            f"got {result.hit_rate}"
        )
        assert result.excluded_partial_count is None, (
            f"expected no excluded_partial_count when the set has no partials, "
            f"got {result.excluded_partial_count}"
        )

    def test_measure_compares_against_universe_base_rate(self) -> None:
        engine = _mock_panel_engine()
        instance_set = _instance_set(_known_instances())

        result = engine.measure(instance_set, horizon_days=5, compare_to_base_rate=True)

        assert result.base_rate is not None, "expected a base rate when compare_to_base_rate=True"
        assert -1.0 < result.base_rate.median < 1.0, (
            f"expected a sane 5-day base-rate median return, got {result.base_rate.median}"
        )
        assert 0.0 <= result.base_rate.hit_rate <= 1.0, (
            f"expected hit_rate to be a fraction, got {result.base_rate.hit_rate}"
        )
        # The base rate is drawn broadly from the panel, not filtered to
        # this setup's own (much smaller, and here unusually bearish)
        # instances — its median should not coincidentally equal the
        # setup's own median.
        assert result.base_rate.median != pytest.approx(result.median), (
            "expected the base rate to be computed independently of the setup's own instances"
        )

    def test_measure_excludes_partial_instances_and_reports_excluded_count(self) -> None:
        engine = _mock_panel_engine()
        instances = _known_instances() + [
            Instance(ticker="MOCK01", date=date(2023, 6, 5), completeness=0.5)
        ]
        instance_set = _instance_set(instances)

        result = engine.measure(instance_set, horizon_days=5, compare_to_base_rate=False)

        assert result.count == 3, (
            f"expected the partial instance excluded from the statistic, got count={result.count}"
        )
        assert result.excluded_partial_count == 1, (
            f"expected excluded_partial_count to report the 1 excluded partial, "
            f"got {result.excluded_partial_count}"
        )


class TestInstanceSplitting:
    def test_split_instances_by_outcome_separates_winners_and_losers(self) -> None:
        # threshold=-0.15 splits the 3 known h=5 returns into a non-trivial
        # winner (MOCK02, -12.76% > -15%) and losers (MOCK01, MOCK03).
        engine = _mock_panel_engine()
        instance_set = _instance_set(_known_instances())

        winners, losers = engine.split_instances(
            instance_set, mode="outcome", horizon_days=5, threshold=-0.15
        )

        assert {inst.ticker for inst in winners.instances} == {"MOCK02"}, (
            f"expected only MOCK02 above the threshold, got {[i.ticker for i in winners.instances]}"
        )
        assert {inst.ticker for inst in losers.instances} == {"MOCK01", "MOCK03"}, (
            f"expected MOCK01 and MOCK03 at/below the threshold, "
            f"got {[i.ticker for i in losers.instances]}"
        )
        assert winners.label == "winners" and losers.label == "losers", (
            f"expected sensible child labels, got {winners.label!r}/{losers.label!r}"
        )
        assert winners.parent_id == instance_set.id and losers.parent_id == instance_set.id, (
            "expected both child sets to reference the source set's id as parent_id"
        )

    def test_split_instances_by_condition_expression(self) -> None:
        # Breakout-day closes: MOCK01 ~245, MOCK02 ~250 (> 100); MOCK03 ~34
        # (<= 100) — a clean, hand-verifiable 2/1 split.
        engine = _mock_panel_engine()
        instance_set = _instance_set(_known_instances())

        true_group, false_group = engine.split_instances(
            instance_set, mode="condition", expression="close > 100"
        )

        assert {inst.ticker for inst in true_group.instances} == {"MOCK01", "MOCK02"}, (
            f"expected MOCK01/MOCK02 (close > 100 at anchor) in the true group, "
            f"got {[i.ticker for i in true_group.instances]}"
        )
        assert {inst.ticker for inst in false_group.instances} == {"MOCK03"}, (
            f"expected MOCK03 (close <= 100 at anchor) in the false group, "
            f"got {[i.ticker for i in false_group.instances]}"
        )
        assert true_group.parent_id == instance_set.id, (
            "expected the true group to reference the source set's id as parent_id"
        )


class TestGridDataWindows:
    def test_get_instance_windows_returns_aligned_price_bars(self) -> None:
        engine = _mock_panel_engine()
        instance_set = _instance_set(_known_instances())

        windows = engine.get_instance_windows(instance_set, n=3, window=(-5, 5))

        assert len(windows) == 3, f"expected 3 windows (all known instances sampled), got {len(windows)}"
        by_ticker = {w.ticker: w for w in windows}
        for k in KNOWN_PATTERN_INSTANCES:
            window = by_ticker[k.ticker]
            assert len(window.bars) == 11, (
                f"expected an un-clipped 11-bar window (-5..+5) for {k.ticker}, "
                f"got {len(window.bars)}"
            )
            assert window.bars[5].date == k.breakout_date, (
                f"expected the middle bar (offset 0) to be the anchor date {k.breakout_date} "
                f"for {k.ticker}, got {window.bars[5].date}"
            )

    def test_get_instance_windows_includes_partial_instances_price_action_so_far(self) -> None:
        # A partial instance anchored at a ticker's very last available row:
        # the window must clip at the panel's trailing edge rather than
        # erroring, returning only the price action that has occurred so far.
        engine = _mock_panel_engine()
        panel_edge_date = date(2025, 12, 31)  # last date in generate_panel()'s calendar
        instance_set = _instance_set(
            [Instance(ticker="MOCK01", date=panel_edge_date, completeness=0.5)]
        )

        windows = engine.get_instance_windows(instance_set, n=1, window=(-3, 20))

        assert len(windows) == 1, f"expected 1 window for the 1 partial instance, got {len(windows)}"
        window = windows[0]
        assert len(window.bars) == 4, (
            f"expected the window clipped to the 4 available trailing bars "
            f"(no future days beyond the panel edge), got {len(window.bars)}"
        )
        assert window.bars[-1].date == panel_edge_date, (
            f"expected the last bar to be the panel's edge date, got {window.bars[-1].date}"
        )
