from fastapi.testclient import TestClient

from api.routes.spike import PANEL_PATH
from main import app
from scripts.generate_mock_panel import generate_panel, write_panel

# Exercises api/routes/research.py's HTTP wiring (request/response mapping,
# error mapping) against the real mock panel -- NOT the pandas engine's
# matching/statistics correctness, which tests/unit/test_pattern_research_
# engine.py already covers against hand-computable fixtures. The frontend's
# src/lib/webmcp/integration.test.ts covers the same endpoints from the
# ResearchEngine/fetch side (URL construction, response mapping).

GAP_UP_SETUP = {
    "id": "setup_1",
    "name": "gap up",
    "steps": [{"condition": "open >= highest(close, 1) * 1.05"}],
}


class TestResearchRoutesEndToEnd:
    def test_find_measure_sample_split_and_grid_chain_through_http(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            found = client.post(
                "/api/research/find-instances",
                json={"setup": GAP_UP_SETUP, "studies": []},
            )
            assert found.status_code == 200, found.text
            instance_set = found.json()
            assert instance_set["instances"], "expected the known gap-up fixture to match"

            measured = client.post(
                "/api/research/measure",
                json={"instance_set": instance_set, "horizon_days": 5},
            )
            assert measured.status_code == 200, measured.text
            assert measured.json()["count"] == instance_set["complete_count"]

            sampled = client.post(
                "/api/research/sample-instances",
                json={"instance_set": instance_set, "n": 2, "strategy": "recent"},
            )
            assert sampled.status_code == 200, sampled.text
            assert len(sampled.json()) <= 2

            split = client.post(
                "/api/research/split-instances",
                json={"instance_set": instance_set, "mode": "outcome", "horizon_days": 5},
            )
            assert split.status_code == 200, split.text
            labels = {child["label"] for child in split.json()}
            assert labels == {"winners", "losers"}

            grid = client.post(
                "/api/research/instance-windows",
                json={"instance_set": instance_set, "n": 2, "window": [-5, 5]},
            )
            assert grid.status_code == 200, grid.text
            assert all(window["bars"] for window in grid.json())

    def test_find_instances_with_unsupported_function_returns_catalog(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)
        bad_setup = {"id": "setup_2", "steps": [{"condition": "zscore(close, 5) > 1"}]}

        with TestClient(app) as client:
            response = client.post(
                "/api/research/find-instances", json={"setup": bad_setup, "studies": []}
            )

        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert "zscore" in detail["message"]
        assert detail["catalog"] == ["sma", "ema", "atr", "highest", "lowest", "days_since"]

    def test_find_instances_resolves_a_study_referenced_by_name(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)
        setup = {
            "id": "setup_3",
            "steps": [{"condition": "rel_vol > 1.0"}],
        }
        studies = [{"id": "study_1", "name": "rel_vol", "expression": "volume / sma(volume, 5)"}]

        with TestClient(app) as client:
            response = client.post(
                "/api/research/find-instances", json={"setup": setup, "studies": studies}
            )

        assert response.status_code == 200, response.text
