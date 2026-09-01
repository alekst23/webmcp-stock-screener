from datetime import date

from pydantic import BaseModel, Field


class PanelStatus(BaseModel):
    """Provenance of the price panel currently loaded by the API.

    Surfaced to the UI (T-0001-9 AC4) so results are never presented as more
    current than the data behind them: `as_of` is the newest bar in the
    panel, not the time of the request.

    The degradation fields (T-1016-5) carry the rest of the truth: whether the
    panel is synthetic, whether it has fallen behind, and which part of the
    universe could not be read. Serve and disclose -- a partial answer with
    its limits attached beats no answer, and beats a partial answer presented
    as a whole one.
    """

    as_of: date
    first_date: date
    ticker_count: int
    row_count: int
    # "object-store" (the real backfilled panel) or "mock" (T-0001-1's
    # synthetic panel). A user reading "mock" knows not to trust a result.
    source: str

    # Set where the panel is loaded, and travels with it.
    is_synthetic: bool = False
    # Ticker ranges the loader could not read, e.g. "AAPL..ADBE". Empty is
    # the normal case and means the universe searched was the whole one.
    missing: list[str] = Field(default_factory=list)

    # Computed per request rather than at load, so a panel that catches up
    # stops being reported as stale without a restart (T-1016-5 AC5).
    is_stale: bool = False
    sessions_behind: int = 0
    notices: list[str] = Field(default_factory=list)
