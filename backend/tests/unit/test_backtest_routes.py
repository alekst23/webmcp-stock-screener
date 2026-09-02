"""T-1014-6: the /api/backtests HTTP boundary.

Builds a standalone FastAPI app carrying only api.routes.backtest's router
-- never imports main.app, which pulls in the pre-existing missing-`limits`
package collection failure documented in this ticket's own Technical
Considerations (backend/tests/functional/ is the affected tier; this stays
in tests/unit/ and sidesteps it entirely by construction, not by working
around the missing dependency).

Proves AC1 (returns before the engine finishes), AC6 (a concurrent read
observes "running" before completion, never partial results as final),
AC7 (a failure resolves to a named reason), AC8 (unknown/evicted ids are
rejected without starting anything) and AC9 (match_frequency pagination).
"""

from __future__ import annotations

import threading
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.backtest import router
from application.backtest_jobs import BacktestJobStore
from domain.errors import InsufficientHistoryError
from domain.models.backtest import (
    BacktestProvenance,
    BacktestRequest,
    BacktestResult,
    DrawdownStats,
    MatchFrequencyPoint,
    RebalanceFrequency,
    SurvivorshipAssumption,
)
from domain.models.screener import UniverseSpec
from domain.models.similarity import MarketDataProvenance


def _request_body() -> dict[str, object]:
    return {
        "screener_id": "scr_1",
        "revision": 1,
        "filter_tree": {
            "node_id": "root",
            "kind": "group",
            "op": "and",
            "children": [
                {
                    "node_id": "c1",
                    "kind": "condition",
                    "condition": {
                        "type": "scalar",
                        "field_id": "close",
                        "operator": "gt",
                        "value": 10.0,
                    },
                }
            ],
        },
        "universe": {"universe_id": "u1", "label": "Test"},
        "from_date": "2024-01-01",
        "to_date": "2024-06-01",
        "horizons": [5],
    }


def _result() -> BacktestResult:
    provenance = BacktestProvenance(
        market_data=MarketDataProvenance(
            as_of="2024-06-01T00:00:00Z",
            source_id="panel.mock",
            source_label="Mock demo panel",
            liveness="historical",
            timezone="UTC",
            price_adjustment="adjusted",
            engine_version="1.0.0",
        )
    )
    match_frequency = [
        MatchFrequencyPoint(on_date=date(2024, 1, d), universe_size=10, match_count=1)
        for d in (1, 8, 15, 22, 29)
    ]
    return BacktestResult(
        screener_id="scr_1",
        revision=1,
        universe=UniverseSpec(universe_id="u1", label="Test"),
        from_date_requested=date(2024, 1, 1),
        to_date_requested=date(2024, 6, 1),
        from_date_covered=date(2024, 1, 1),
        to_date_covered=date(2024, 6, 1),
        horizons=[5],
        rebalance=RebalanceFrequency.WEEKLY,
        match_count_total=5,
        match_frequency=match_frequency,
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


class _GatedEngine:
    """A fake BacktestEngine whose run() blocks on a threading.Event until
    released -- lets a test deterministically observe "running" before
    completion, rather than racing a real computation's wall-clock time."""

    def __init__(self) -> None:
        self.release = threading.Event()
        self.ran_with: BacktestRequest | None = None

    def run(self, request: BacktestRequest) -> BacktestResult:
        self.ran_with = request
        self.release.wait(timeout=5)
        return _result()


class _FailingEngine:
    def run(self, request: BacktestRequest) -> BacktestResult:
        raise InsufficientHistoryError(
            "not enough history", available_sessions=1, required_sessions=10
        )


class _ImmediateEngine:
    def run(self, request: BacktestRequest) -> BacktestResult:
        return _result()


def _app(engine: object, jobs: BacktestJobStore | None = None) -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.state.backtest_engine = engine
    app.state.backtest_jobs = jobs or BacktestJobStore()
    return app


class TestStartBacktest:
    def test_returns_202_with_backtest_id_before_engine_finishes(self) -> None:
        engine = _GatedEngine()
        with TestClient(_app(engine)) as client:
            response = client.post("/api/backtests", json=_request_body())

            assert response.status_code == 202, response.text
            body = response.json()
            assert body["backtest_id"], "expected a non-empty backtest_id"
            assert body["status"] == "running", f"got {body['status']}"
            # AC1: the engine has not necessarily even started yet, let
            # alone finished -- the response came back before release().
            engine.release.set()

    def test_empty_horizons_rejected_with_422(self) -> None:
        engine = _ImmediateEngine()
        with TestClient(_app(engine)) as client:
            body = _request_body()
            body["horizons"] = []

            response = client.post("/api/backtests", json=body)

            assert response.status_code == 422, response.text

    def test_no_engine_configured_returns_503(self) -> None:
        app = FastAPI()
        app.include_router(router)
        app.state.backtest_engine = None
        app.state.backtest_jobs = BacktestJobStore()
        with TestClient(app) as client:
            response = client.post("/api/backtests", json=_request_body())

            assert response.status_code == 503, response.text


class TestGetBacktestResults:
    def test_running_status_observed_before_completion(self) -> None:
        engine = _GatedEngine()
        with TestClient(_app(engine)) as client:
            start = client.post("/api/backtests", json=_request_body())
            backtest_id = start.json()["backtest_id"]

            running = client.get(f"/api/backtests/{backtest_id}")

            assert running.status_code == 200, running.text
            body = running.json()
            assert body["status"] == "running", f"got {body}"
            assert body["result"] is None, "AC6: a running backtest must never carry a result"
            assert body["progress"] is not None, "expected progress information while running"

            engine.release.set()

    def test_completed_status_carries_full_result_and_reads_are_stable(self) -> None:
        engine = _ImmediateEngine()
        with TestClient(_app(engine)) as client:
            start = client.post("/api/backtests", json=_request_body())
            backtest_id = start.json()["backtest_id"]
            _wait_until_finished(client, backtest_id)

            first = client.get(f"/api/backtests/{backtest_id}")
            second = client.get(f"/api/backtests/{backtest_id}")

            assert first.status_code == 200 and second.status_code == 200
            first_body, second_body = first.json(), second.json()
            assert first_body["status"] == "completed", f"got {first_body}"
            assert first_body["result"]["revision"] == 1
            assert (
                first_body == second_body
            ), "AC5: repeated reads must return identical stored results"

    def test_failed_engine_resolves_to_failed_status_with_reason(self) -> None:
        engine = _FailingEngine()
        with TestClient(_app(engine)) as client:
            start = client.post("/api/backtests", json=_request_body())
            backtest_id = start.json()["backtest_id"]
            _wait_until_finished(client, backtest_id)

            response = client.get(f"/api/backtests/{backtest_id}")

            body = response.json()
            assert body["status"] == "failed", f"got {body}"
            assert "not enough history" in (body["error"] or ""), f"got {body['error']}"
            assert body["result"] is None, "a failed backtest must never carry a result"

    def test_unknown_id_is_rejected_without_starting_anything(self) -> None:
        engine = _ImmediateEngine()
        store = BacktestJobStore()
        with TestClient(_app(engine, store)) as client:
            response = client.get("/api/backtests/backtest_does_not_exist")

            assert response.status_code == 404, response.text
            assert response.json()["detail"]["reason"] == "unknown"

    def test_evicted_id_is_rejected_and_named_as_evicted(self) -> None:
        engine = _ImmediateEngine()
        store = BacktestJobStore(max_jobs=1)
        with TestClient(_app(engine, store)) as client:
            first = client.post("/api/backtests", json=_request_body())
            first_id = first.json()["backtest_id"]
            _wait_until_finished(client, first_id)
            second = client.post("/api/backtests", json=_request_body())
            _wait_until_finished(client, second.json()["backtest_id"])

            response = client.get(f"/api/backtests/{first_id}")

            assert response.status_code == 404, response.text
            assert response.json()["detail"]["reason"] == "evicted", response.text

    def test_match_frequency_is_paginated_with_stable_ids_and_total(self) -> None:
        engine = _ImmediateEngine()
        with TestClient(_app(engine)) as client:
            start = client.post("/api/backtests", json=_request_body())
            backtest_id = start.json()["backtest_id"]
            _wait_until_finished(client, backtest_id)

            page1 = client.get(
                f"/api/backtests/{backtest_id}", params={"offset": 0, "limit": 2}
            ).json()
            page2 = client.get(
                f"/api/backtests/{backtest_id}", params={"offset": 2, "limit": 2}
            ).json()

            result1, result2 = page1["result"], page2["result"]
            assert len(result1["match_frequency"]) == 2, result1
            assert result1["match_frequency_total"] == 5, result1
            assert result1["match_frequency_offset"] == 0
            assert result1["match_frequency_next_offset"] == 2
            assert len(result2["match_frequency"]) == 2, result2
            assert result2["match_frequency_offset"] == 2
            ids1 = {p["id"] for p in result1["match_frequency"]}
            ids2 = {p["id"] for p in result2["match_frequency"]}
            assert ids1.isdisjoint(ids2), "expected distinct pages to carry distinct point ids"

            # Re-reading the same page returns the exact same ids (AC9's
            # "stable ids"), not freshly minted ones.
            page1_again = client.get(
                f"/api/backtests/{backtest_id}", params={"offset": 0, "limit": 2}
            ).json()
            assert [p["id"] for p in page1_again["result"]["match_frequency"]] == [
                p["id"] for p in result1["match_frequency"]
            ]


def _wait_until_finished(client: TestClient, backtest_id: str, timeout: float = 5.0) -> None:
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = client.get(f"/api/backtests/{backtest_id}").json()["status"]
        if status != "running":
            return
        time.sleep(0.01)
    pytest.fail(f"backtest {backtest_id} did not finish within {timeout}s")
