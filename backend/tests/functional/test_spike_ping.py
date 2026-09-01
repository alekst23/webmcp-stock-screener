from fastapi.testclient import TestClient

from api.routes.spike import PANEL_PATH
from main import app
from scripts.generate_mock_panel import generate_panel, write_panel


class TestSpikePingEndpoint:
    def test_ping_endpoint_returns_sample_price_bar_from_mock_panel(self) -> None:
        # The mock panel is a gitignored build artifact (T-0001-1); regenerate
        # it at its real, documented path so this test exercises the same
        # file the endpoint reads in local dev, not a decoupled fixture.
        write_panel(generate_panel(), output_path=PANEL_PATH)

        with TestClient(app) as client:
            response = client.get("/api/spike/ping")

        assert (
            response.status_code == 200
        ), f"expected 200, got {response.status_code}: {response.text}"
        body = response.json()
        assert body["message"], f"expected a non-empty message, got {body}"

        sample = body["sample"]
        for field in ("ticker", "date", "open", "high", "low", "close", "volume"):
            assert field in sample, f"expected sample to include {field!r}, got {sample}"
        assert (
            sample["low"]
            <= min(sample["open"], sample["close"])
            <= max(sample["open"], sample["close"])
            <= sample["high"]
        ), f"expected valid OHLC ordering, got {sample}"
        assert sample["volume"] > 0, f"expected positive volume, got {sample['volume']}"
