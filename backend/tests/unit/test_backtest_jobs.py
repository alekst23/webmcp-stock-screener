"""T-1014-6: BacktestJobStore -- the structural "no silent rerun"
guarantee (AC5, AC8): nothing reachable from this store can produce a
fresh BacktestResult under an existing id, only `complete()`/`fail()`
(called once, by the route's own background execution) ever set one."""

from __future__ import annotations

from datetime import date, datetime, timezone

from application.backtest_jobs import BacktestJobNotAvailable, BacktestJobStore
from domain.models.backtest import (
    BacktestProvenance,
    BacktestRequest,
    BacktestResult,
    DrawdownStats,
    RebalanceFrequency,
    SurvivorshipAssumption,
)
from domain.models.screener import ConditionNode, GroupNode, ScalarCondition, UniverseSpec
from domain.models.similarity import MarketDataProvenance


def _request(horizons: list[int] | None = None) -> BacktestRequest:
    tree = GroupNode(
        node_id="root",
        op="and",
        children=[
            ConditionNode(
                node_id="c1",
                condition=ScalarCondition(field_id="close", operator="gt", value=10.0),
            )
        ],
    )
    return BacktestRequest(
        screener_id="scr_1",
        revision=1,
        filter_tree=tree,
        universe=UniverseSpec(universe_id="u1", label="Test"),
        from_date=date(2024, 1, 1),
        to_date=date(2024, 6, 1),
        horizons=horizons or [5],
    )


def _result(revision: int = 1) -> BacktestResult:
    provenance = BacktestProvenance(
        market_data=MarketDataProvenance(
            as_of=datetime(2024, 6, 1, tzinfo=timezone.utc),
            source_id="panel.mock",
            source_label="Mock demo panel",
            liveness="historical",
            timezone="UTC",
            price_adjustment="adjusted",
            engine_version="1.0.0",
        )
    )
    return BacktestResult(
        screener_id="scr_1",
        revision=revision,
        universe=UniverseSpec(universe_id="u1", label="Test"),
        from_date_requested=date(2024, 1, 1),
        to_date_requested=date(2024, 6, 1),
        from_date_covered=date(2024, 1, 1),
        to_date_covered=date(2024, 6, 1),
        horizons=[5],
        rebalance=RebalanceFrequency.WEEKLY,
        match_count_total=0,
        match_frequency=[],
        forward_returns=[],
        drawdown=DrawdownStats(
            count=0, mean_max_drawdown=0.0, median_max_drawdown=0.0, worst_max_drawdown=0.0
        ),
        survivorship=SurvivorshipAssumption(
            includes_delisted=False,
            includes_merged=False,
            includes_renamed=False,
            delisting_events_in_range=0,
            statement="no coverage",
        ),
        provenance=provenance,
        warnings=[],
    )


class TestBacktestJobStoreLifecycle:
    def test_create_returns_running_job_with_stable_id(self) -> None:
        store = BacktestJobStore()

        job = store.create(_request())

        assert (
            job.status == "running"
        ), f"expected a freshly created job to be running, got {job.status}"
        assert job.backtest_id, "expected a non-empty backtest_id"

    def test_create_twice_mints_different_ids(self) -> None:
        store = BacktestJobStore()

        first = store.create(_request())
        second = store.create(_request())

        assert first.backtest_id != second.backtest_id, "expected distinct ids per create() call"

    def test_complete_sets_status_and_result(self) -> None:
        store = BacktestJobStore()
        job = store.create(_request())
        result = _result()

        store.complete(job.backtest_id, result)

        fetched = store.get(job.backtest_id)
        assert not isinstance(fetched, BacktestJobNotAvailable), f"expected the job, got {fetched}"
        assert fetched.status == "completed", f"got {fetched.status}"
        assert fetched.result is result, "expected the exact result object stored, not a copy"

    def test_fail_sets_status_and_error(self) -> None:
        store = BacktestJobStore()
        job = store.create(_request())

        store.fail(job.backtest_id, "not enough history")

        fetched = store.get(job.backtest_id)
        assert not isinstance(fetched, BacktestJobNotAvailable)
        assert fetched.status == "failed", f"got {fetched.status}"
        assert fetched.error == "not enough history", f"got {fetched.error}"

    def test_reading_a_completed_job_repeatedly_returns_the_same_result(self) -> None:
        # AC5 at the store layer: no method here can produce a second,
        # different result under the same id.
        store = BacktestJobStore()
        job = store.create(_request())
        result = _result()
        store.complete(job.backtest_id, result)

        first_read = store.get(job.backtest_id)
        second_read = store.get(job.backtest_id)

        assert not isinstance(first_read, BacktestJobNotAvailable)
        assert not isinstance(second_read, BacktestJobNotAvailable)
        assert (
            first_read.result is second_read.result is result
        ), "expected repeated reads to return the exact same stored result"


class TestBacktestJobStoreNotAvailable:
    def test_unknown_id_is_reported_as_unknown_not_evicted(self) -> None:
        store = BacktestJobStore()

        outcome = store.get("backtest_does_not_exist")

        assert isinstance(outcome, BacktestJobNotAvailable), f"expected NotAvailable, got {outcome}"
        assert outcome.reason == "unknown", f"got {outcome.reason}"
        assert outcome.available is False

    def test_eviction_reclaims_oldest_finished_job_beyond_the_bound(self) -> None:
        store = BacktestJobStore(max_jobs=2)
        ids = []
        for _ in range(3):
            job = store.create(_request())
            store.complete(job.backtest_id, _result())
            ids.append(job.backtest_id)

        oldest = store.get(ids[0])
        newest = store.get(ids[-1])

        assert isinstance(
            oldest, BacktestJobNotAvailable
        ), f"expected the oldest to be evicted, got {oldest}"
        assert oldest.reason == "evicted", f"expected reason 'evicted', got {oldest.reason}"
        assert not isinstance(newest, BacktestJobNotAvailable), "expected the newest job to remain"

    def test_evicted_id_never_starts_a_new_evaluation(self) -> None:
        # The structural guarantee itself: BacktestJobStore exposes no
        # method an evicted-or-unknown read could call to compute a fresh
        # result. Reading it twice never differs.
        store = BacktestJobStore(max_jobs=1)
        job = store.create(_request())
        store.complete(job.backtest_id, _result())
        second = store.create(_request())
        store.complete(second.backtest_id, _result())

        first_read = store.get(job.backtest_id)
        second_read = store.get(job.backtest_id)

        assert (
            first_read == second_read
        ), "expected an evicted id to report the same outcome every read"

    def test_running_job_is_never_evicted(self) -> None:
        store = BacktestJobStore(max_jobs=1)
        running = store.create(_request())
        for _ in range(3):
            job = store.create(_request())
            store.complete(job.backtest_id, _result())

        fetched = store.get(running.backtest_id)

        assert not isinstance(
            fetched, BacktestJobNotAvailable
        ), "expected a still-running job to survive eviction pressure from finished jobs"
        assert fetched.status == "running", f"got {fetched.status}"

    def test_reading_a_job_keeps_it_from_being_the_next_eviction(self) -> None:
        store = BacktestJobStore(max_jobs=2)
        first = store.create(_request())
        store.complete(first.backtest_id, _result())
        second = store.create(_request())
        store.complete(second.backtest_id, _result())

        # Touch `first` so it is no longer the least-recently-used entry.
        store.get(first.backtest_id)

        third = store.create(_request())
        store.complete(third.backtest_id, _result())

        assert not isinstance(
            store.get(first.backtest_id), BacktestJobNotAvailable
        ), "expected the recently-read job to survive eviction over the untouched one"
        assert isinstance(
            store.get(second.backtest_id), BacktestJobNotAvailable
        ), "expected the untouched job to be the one evicted"
