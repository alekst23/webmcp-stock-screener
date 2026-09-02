from datetime import date

from pydantic import BaseModel


class TickerMetadata(BaseModel):
    """Per-ticker classification used for universe filtering
    (findInstances' minMarketCap/sectors args). Sourced from a free Nasdaq
    screener export, not EODHD — see data-provider.md."""

    ticker: str
    sector: str | None = None
    market_cap: float | None = None
    as_of: date


class EligibilityRecord(BaseModel):
    """One ticker's measured stats against the enforced universe floor
    (domain/universe_floor.py), as of the panel state they were computed
    from. Distinct from TickerMetadata: this is computed from the panel's
    own trailing price/volume history, not sourced from the Nasdaq screener
    export, and gates panel content rather than describing sector/cap."""

    ticker: str
    median_dollar_volume: float
    last_close: float
    history_sessions: int
    as_of: date
