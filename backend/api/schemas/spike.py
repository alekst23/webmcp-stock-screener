from pydantic import BaseModel

from domain.models.price import PriceBar


class SpikePingResponse(BaseModel):
    """Throwaway response for the T-0001-2 platform spike, proving a WebMCP
    tool's execute() can reach a live, deployed backend. Superseded by the
    real tool endpoints wired in T-0001-5."""

    message: str
    sample: PriceBar
