"""T-0025-2: api/routes/screener.py's HTTP wiring.

Exercises the route against the real mock panel (narrowing/evaluation/
ranking correctness is PortScreenerRunEngine's own concern --
tests/unit/test_screener_run_engine.py -- this proves the HTTP boundary:
status codes, response shape), following tests/functional/test_chart_routes.py's
established pattern of writing the real mock panel and hitting the real app.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main as main_module
from scripts.generate_mock_panel import generate_panel, write_panel

TICKER = "MOCK01"

_LENIENT_TREE = {
    "node_id": "root",
    "kind": "group",
    "op": "and",
    "enabled": True,
    "children": [
        {
            "node_id": "n1",
            "kind": "condition",
            "enabled": True,
            "condition": {
                "type": "scalar",
                "field_id": "close",
                "operator": "op.greater_than",
                "value": 0.0,
            },
        }
    ],
}


def _request(**overrides: object) -> dict:
    base: dict[str, object] = {
        "universe": {"universe_id": "u1", "label": "Test", "tickers": [TICKER]},
        "filter_tree": _LENIENT_TREE,
        "limit": 10,
    }
    base.update(overrides)
    return base


class TestRunScreenerEndToEnd:
    def test_happy_path_returns_a_complete_run(self) -> None:
        write_panel(generate_panel(), output_path=main_module.PANEL_PATH)

        with TestClient(main_module.app) as client:
            response = client.post("/api/screener/run", json=_request())

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "complete", f"got {body}"
        assert body["universe_count"] == 1, f"got {body}"
        assert body["matched_count"] == 1, f"expected the lenient condition to match, got {body}"
        assert body["matches"], "expected at least one match in the body"
        instrument = body["matches"][0]["instrument"]
        assert instrument["instrument_id"] == TICKER, f"got {instrument}"
        assert "root" in body["matches"][0]["node_evaluations"], f"got {body['matches'][0]}"

    def test_dry_run_reports_without_executing(self) -> None:
        write_panel(generate_panel(), output_path=main_module.PANEL_PATH)

        with TestClient(main_module.app) as client:
            response = client.post("/api/screener/run", json=_request(dry_run=True))

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "valid", f"got {body}"
        assert body["matches"] == [], "expected dry_run to never execute"

    def test_empty_universe_is_refused_not_empty_success(self) -> None:
        write_panel(generate_panel(), output_path=main_module.PANEL_PATH)
        request = _request(
            universe={"universe_id": "u1", "label": "Test", "tickers": ["NOT_A_REAL_TICKER"]}
        )

        with TestClient(main_module.app) as client:
            response = client.post("/api/screener/run", json=request)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "refused", f"expected a named refusal, got {body}"
        codes = [p["code"] for p in body["problems"]]
        assert "empty_universe" in codes, f"got {codes}"

    def test_returns_503_when_no_panel_is_loaded(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setattr(main_module, "PANEL_PATH", tmp_path / "absent.parquet")

        with TestClient(main_module.app) as client:
            response = client.post("/api/screener/run", json=_request())

        assert response.status_code == 503, response.text
