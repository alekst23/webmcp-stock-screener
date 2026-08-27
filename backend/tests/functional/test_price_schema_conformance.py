from datetime import date

from domain.models.price import PriceBar
from scripts.fetch_eodhd_sample import eodhd_row_to_price_bar

# Representative shape of one row from EODHD's per-ticker EOD endpoint
# (docs/reference/data-provider.md), based on their documented response
# format -- no live network call needed to check field-shape conformance.
# `adjusted_close` deliberately differs from `close` here to exercise the
# split/dividend adjustment convention this test guards against.
EODHD_SAMPLE_ROW = {
    "date": "2024-01-02",
    "open": 187.15,
    "high": 188.44,
    "low": 183.885,
    "close": 185.64,
    "adjusted_close": 184.29,
    "volume": 82488700,
}


class TestPanelSchemaConformance:
    def test_price_bar_schema_matches_real_source_field_shape(self) -> None:
        bar = eodhd_row_to_price_bar("AAPL", EODHD_SAMPLE_ROW)

        assert isinstance(bar, PriceBar), f"expected a PriceBar, got {type(bar)}"
        assert bar.ticker == "AAPL", f"expected ticker AAPL, got {bar.ticker}"
        assert bar.date == date(2024, 1, 2), f"expected 2024-01-02, got {bar.date}"
        assert bar.volume == 82488700, f"expected volume 82488700, got {bar.volume}"

        # `close` must come from adjusted_close, not the raw close -- the
        # value convention AC3 exists to confirm matches the real source.
        assert bar.close == 184.29, f"expected adjusted close 184.29, got {bar.close}"

        # EODHD only adjusts `close` directly; open/high/low must be scaled
        # by the same factor to stay on the same (adjusted) price basis as
        # close, or O/H/L would silently disagree with C across any split
        # or ex-dividend date.
        adjustment_factor = 184.29 / 185.64
        assert bar.open == round(
            187.15 * adjustment_factor, 4
        ), f"expected open scaled by the adjustment factor, got {bar.open}"
        assert bar.high == round(
            188.44 * adjustment_factor, 4
        ), f"expected high scaled by the adjustment factor, got {bar.high}"
        assert bar.low == round(
            183.885 * adjustment_factor, 4
        ), f"expected low scaled by the adjustment factor, got {bar.low}"

        assert (
            bar.low <= min(bar.open, bar.close) <= max(bar.open, bar.close) <= bar.high
        ), f"expected valid OHLC ordering after adjustment, got {bar}"
