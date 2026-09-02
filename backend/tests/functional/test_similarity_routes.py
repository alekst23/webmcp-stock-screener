from fastapi.testclient import TestClient

from api.routes.spike import PANEL_PATH
from main import app
from scripts.generate_mock_panel import generate_panel, write_panel

# Exercises api/routes/similarity.py's HTTP wiring against the real mock
# panel -- not the engine's matching/scoring correctness, which
# tests/unit/test_similarity_engine.py already covers against hand-computable
# fixtures. No route-level fake engine, matching this ticket's Technical
# Considerations: AC10 already forces the route to carry no analytical
# logic, so the real engine is more evidence than a name-keyed fake.

REFERENCE_WINDOW = {"start": "2023-03-01", "end": "2023-03-31", "timeframe": "1d"}


def _search_payload(**overrides: object) -> dict:
    payload: dict = {
        "instrument_id": "MOCK01",
        "window": REFERENCE_WINDOW,
        "scope": "cross_instrument",
        "limit": 10,
    }
    payload.update(overrides)
    return payload


class TestSimilarityRoutesEndToEnd:
    def test_search_returns_pinned_run_with_ranked_candidates_and_provenance(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            response = client.post("/api/similarity/search", json=_search_payload())

        assert response.status_code == 200, response.text
        run = response.json()
        assert run["run_id"], "expected a stable run id"
        assert run["scope"] == "cross_instrument"
        assert run["reference_setup_id"] == "MOCK01", "expected the fallback reference_setup_id"
        assert run["candidates"], "expected the mock universe to produce candidates"
        for candidate in run["candidates"]:
            assert candidate["candidate_id"], "expected a stable candidate id, never a bare ticker"
            assert candidate[
                "per_family_similarity"
            ], "AC3: no candidate may be returned as a score with no feature breakdown"
        scores = [c["score"] for c in run["candidates"]]
        assert scores == sorted(
            scores, reverse=True
        ), "expected candidates ranked by descending score"
        provenance = run["provenance"]
        for field in ("as_of", "source_id", "liveness", "timezone", "engine_version"):
            assert field in provenance, f"expected provenance to state {field}"

    def test_get_run_pages_candidates_deterministically(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            searched = client.post("/api/similarity/search", json=_search_payload(limit=6))
            run_id = searched.json()["run_id"]

            first_page = client.get(
                f"/api/similarity/runs/{run_id}", params={"offset": 0, "limit": 3}
            )
            second_page = client.get(
                f"/api/similarity/runs/{run_id}", params={"offset": 3, "limit": 3}
            )
            reread_first_page = client.get(
                f"/api/similarity/runs/{run_id}", params={"offset": 0, "limit": 3}
            )

        assert first_page.status_code == 200, first_page.text
        assert second_page.status_code == 200, second_page.text
        first_ids = [c["candidate_id"] for c in first_page.json()["candidates"]]
        second_ids = [c["candidate_id"] for c in second_page.json()["candidates"]]
        assert len(first_ids) == 3
        assert set(first_ids).isdisjoint(second_ids), "expected the two pages to not overlap"
        assert first_page.json()["next_offset"] == 3
        assert first_page.json()["total_candidates"] == 6
        assert reread_first_page.json()["candidates"] == first_page.json()["candidates"], (
            "expected the same run id to yield the same page contents on a re-read, without "
            "re-running the search"
        )

    def test_explain_returns_a_reconciling_contribution_breakdown(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            searched = client.post(
                "/api/similarity/search",
                json=_search_payload(weights={"price_shape": 0.8, "volume": 0.2}),
            )
            run = searched.json()
            candidate_id = run["candidates"][0]["candidate_id"]

            explained = client.get(
                f"/api/similarity/runs/{run['run_id']}/candidates/{candidate_id}/explanation"
            )

        assert explained.status_code == 200, explained.text
        explanation = explained.json()
        assert explanation["candidate_id"] == candidate_id
        total = sum(explanation["contributions"].values())
        assert abs(total - explanation["overall_score"]) < 1e-6, (
            f"expected contributions to reconcile to the overall score, got {total} vs "
            f"{explanation['overall_score']}"
        )
        assert (
            explanation["overall_score"] == run["candidates"][0]["score"]
        ), "expected the explained score to match the score the search returned"

    def test_get_run_with_unknown_id_returns_404_naming_it(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            response = client.get("/api/similarity/runs/does_not_exist")

        assert response.status_code == 404, response.text
        assert "does_not_exist" in response.json()["detail"]["message"]

    def test_explain_with_candidate_not_in_run_returns_404(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            searched = client.post("/api/similarity/search", json=_search_payload())
            run_id = searched.json()["run_id"]

            response = client.get(
                f"/api/similarity/runs/{run_id}/candidates/not_a_real_id/explanation"
            )

        assert response.status_code == 404, response.text
        assert "not_a_real_id" in response.json()["detail"]["message"]

    def test_search_with_unknown_feature_family_returns_422_naming_it(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            response = client.post(
                "/api/similarity/search",
                json=_search_payload(weights={"not_a_real_family": 1.0}),
            )

        assert response.status_code == 422, response.text
        assert "not_a_real_family" in response.json()["detail"]["message"]

    def test_search_with_negative_weight_returns_422(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            response = client.post(
                "/api/similarity/search", json=_search_payload(weights={"volume": -1.0})
            )

        assert response.status_code == 422, response.text
        assert "volume" in response.json()["detail"]["message"]

    def test_search_with_no_history_for_the_reference_returns_422_not_an_empty_result(
        self,
    ) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            response = client.post(
                "/api/similarity/search",
                json=_search_payload(instrument_id="NOT_A_TICKER"),
            )

        assert response.status_code == 422, response.text
        assert "NOT_A_TICKER" in response.json()["detail"]["message"]
