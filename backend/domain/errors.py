from core.exceptions import DomainError


class ExpressionError(DomainError):
    """Raised when a study/condition expression fails to parse. Carries the
    full function catalog so the caller (often an AI agent) can self-correct
    in one turn instead of retrying blind."""

    def __init__(self, message: str, catalog: list[str]) -> None:
        super().__init__(message)
        self.catalog = catalog


class PanelStoreError(DomainError):
    """Raised when the panel object store cannot be read or written."""


class PriceSourceError(DomainError):
    """Raised when the upstream market-data provider cannot be reached, or
    returns a payload that does not conform to the PriceBar contract."""
