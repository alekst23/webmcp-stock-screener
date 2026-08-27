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
