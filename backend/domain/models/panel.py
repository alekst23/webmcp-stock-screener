from datetime import date

from pydantic import BaseModel


class PanelStatus(BaseModel):
    """Provenance of the price panel currently loaded by the API.

    Surfaced to the UI (T-0001-9 AC4) so results are never presented as more
    current than the data behind them: `as_of` is the newest bar in the
    panel, not the time of the request.
    """

    as_of: date
    first_date: date
    ticker_count: int
    row_count: int
    # "object-store" (the real backfilled panel) or "mock" (T-0001-1's
    # synthetic panel). A user reading "mock" knows not to trust a result.
    source: str
