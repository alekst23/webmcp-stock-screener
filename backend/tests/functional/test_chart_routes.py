"""Post-EPIC-1015 hardening: api/routes/chart.py's HTTP wiring.

Exercises the route against the real mock panel (bar retrieval correctness
is PanelPriceSeriesPort's own concern -- tests/unit/test_panel_market_data.py
-- this proves the HTTP boundary: status codes, error mapping, response
shape), following tests/functional/test_similarity_routes.py's established
pattern of writing the real mock panel and hitting the real app.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.chart import router as chart_router
from main import PANEL_PATH, app
from scripts.generate_mock_panel import generate_panel, write_panel

TICKER = "MOCK01"


class TestGetBarsEndToEnd:
    def test_returns_bars_for_a_known_ticker_in_range(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            response = client.get(
                "/api/chart/bars",
                params={"ticker": TICKER, "start": "2023-03-01", "end": "2023-03-10"},
            )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["ticker"] == TICKER
        assert body["start"] == "2023-03-01"
        assert body["end"] == "2023-03-10"
        assert body["bars"], "expected real bars for a known ticker/range"
        for bar in body["bars"]:
            assert bar["ticker"] == TICKER
            for field in ("date", "open", "high", "low", "close", "volume"):
                assert field in bar, f"expected bar to carry {field}, got {bar}"
        dates = [bar["date"] for bar in body["bars"]]
        assert dates == sorted(dates), "expected bars ordered chronologically"
        assert all("2023-03-01" <= d <= "2023-03-10" for d in dates), (
            "expected every bar's date inside the requested window, got " f"{dates}"
        )

    def test_unknown_ticker_returns_404(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            response = client.get(
                "/api/chart/bars",
                params={"ticker": "NOT_A_REAL_TICKER", "start": "2023-03-01", "end": "2023-03-10"},
            )

        assert response.status_code == 404, response.text

    def test_end_before_start_returns_422(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            response = client.get(
                "/api/chart/bars",
                params={"ticker": TICKER, "start": "2023-03-10", "end": "2023-03-01"},
            )

        assert response.status_code == 422, response.text

    def test_malformed_date_returns_422(self) -> None:
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            response = client.get(
                "/api/chart/bars",
                params={"ticker": TICKER, "start": "not-a-date", "end": "2023-03-10"},
            )

        assert response.status_code == 422, response.text

    def test_a_known_ticker_with_no_bars_in_window_returns_200_with_empty_bars(self) -> None:
        # Distinguishes "unknown ticker" (404) from "known ticker, empty
        # window" (200, []) -- both are legitimate, different answers.
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            response = client.get(
                "/api/chart/bars",
                params={"ticker": TICKER, "start": "1990-01-01", "end": "1990-01-02"},
            )

        assert response.status_code == 200, response.text
        assert response.json()["bars"] == []


class TestGetBarsNoPanelLoaded:
    def test_returns_503_when_no_panel_is_loaded(self) -> None:
        bare_app = FastAPI()
        bare_app.include_router(chart_router)
        bare_app.state.price_series_port = None

        with TestClient(bare_app) as client:
            response = client.get(
                "/api/chart/bars",
                params={"ticker": TICKER, "start": "2023-03-01", "end": "2023-03-10"},
            )

        assert response.status_code == 503, response.text
