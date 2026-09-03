"""Request/response schema for the chart panel's bar-serving endpoint.

One route, one response shape: `ChartBarsResponse` reuses `PriceBar`
(domain.models.price) directly rather than declaring a parallel bar shape --
the same convention api/schemas/similarity.py's response models follow for
domain entities a route's response IS, unmodified.
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel

from domain.models.price import PriceBar


class ChartBarsResponse(BaseModel):
    """OHLCV bars for one ticker over `[start, end]`, inclusive."""

    ticker: str
    start: date
    end: date
    bars: list[PriceBar]
