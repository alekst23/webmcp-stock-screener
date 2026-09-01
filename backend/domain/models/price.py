from datetime import date

from pydantic import BaseModel


class PriceBar(BaseModel):
    """One adjusted daily OHLCV row. The shared schema both the mock generator
    (T-0001-1) and the real EODHD pipeline (T-0001-9) must produce, so swapping
    one panel for the other requires no downstream code changes."""

    ticker: str
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: int
