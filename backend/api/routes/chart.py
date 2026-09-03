"""The chart panel's own price-bar endpoint (post-EPIC-1015 hardening: bug
fix, see git history).

T-1015-4 deleted api/routes/research.py, including the only route that had
served OHLCV bars (POST /api/research/instance-windows) -- an
instance-oriented endpoint the chart's real, already-built data adapter
(src/lib/workbench/chart/infra/httpChartSeries.ts) had to synthesize a fake
"one instance per calendar day" request around just to get bars out of it.
No surviving route replaced it (similarity and backtest both consume price
data internally but neither exposes raw bars), so the chart panel had
nothing to call.

Deliberately thin, mirroring api/routes/similarity.py's own convention
(AC10 there): request validation, error mapping, no analytical logic. Bars
are read straight off the loaded panel via `PanelPriceSeriesPort.get_bars`
(T-1014-6, already built for the backtest engine's price port) -- this
route adds no new bar-reading logic, only the HTTP boundary onto it.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request

from api.schemas.chart import ChartBarsResponse
from infra.panel_market_data import PanelPriceSeriesPort

router = APIRouter(prefix="/api/chart", tags=["chart"])

# Mirrors api/routes/similarity.py's own _NO_PANEL guard: this route reads
# off the same loaded panel, so it fails the same way for the same reason.
_NO_PANEL = (
    "No price panel is loaded, so there are no bars to serve. The panel could "
    "not be read from object storage and no local mock panel exists. From "
    "backend/, run `uv run python scripts/generate_mock_panel.py` first."
)


def get_price_series_port(request: Request) -> PanelPriceSeriesPort:
    port = getattr(request.app.state, "price_series_port", None)
    if not isinstance(port, PanelPriceSeriesPort):
        raise HTTPException(status_code=503, detail=_NO_PANEL)
    return port


@router.get("/bars", response_model=ChartBarsResponse)
def get_bars(
    ticker: str,
    start: date,
    end: date,
    port: PanelPriceSeriesPort = Depends(get_price_series_port),
) -> ChartBarsResponse:
    if end < start:
        raise HTTPException(
            status_code=422,
            detail={"message": f'end date "{end}" precedes start date "{start}".'},
        )
    if not port.has_ticker(ticker):
        raise HTTPException(
            status_code=404,
            detail={"message": f'Unknown ticker "{ticker}": no bars for it in the loaded panel.'},
        )
    bars = port.get_bars(ticker, start, end)
    return ChartBarsResponse(ticker=ticker, start=start, end=end, bars=bars)
