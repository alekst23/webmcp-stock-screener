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


class PanelSchemaError(DomainError):
    """Raised when a stored panel does not match the agreed column contract.

    The bulk load path validates columns rather than rows, so this is where
    producer drift surfaces -- naming the offending column, before any of the
    panel is materialized.
    """


class PriceSourceError(DomainError):
    """Raised when the upstream market-data provider cannot be reached, or
    returns a payload that does not conform to the PriceBar contract."""


class SimilarityReferenceUnavailableError(DomainError):
    """Raised when a similarity search's reference instrument/window has no
    history in the loaded panel -- there is nothing to compare candidates
    against, which reads as "no similar setups exist" if allowed through as
    an empty result instead (EPIC-1012 T-1012-2/T-1012-3 AC7)."""

    def __init__(self, instrument_id: str, message: str) -> None:
        super().__init__(message)
        self.instrument_id = instrument_id


class SimilarityRunNotFoundError(DomainError):
    """Raised when a similarity run ID does not correspond to any pinned run
    -- either it never existed or it was evicted (EPIC-1012 T-1012-2/
    T-1012-3 AC5/AC8)."""

    def __init__(self, run_id: str) -> None:
        super().__init__(f"Similarity run not found: {run_id!r}")
        self.run_id = run_id


class SimilarityCandidateNotFoundError(DomainError):
    """Raised when a candidate ID is not part of the named run (EPIC-1012
    T-1012-2/T-1012-3 AC5)."""

    def __init__(self, run_id: str, candidate_id: str) -> None:
        super().__init__(f"Candidate {candidate_id!r} is not part of run {run_id!r}")
        self.run_id = run_id
        self.candidate_id = candidate_id


class InsufficientHistoryError(DomainError):
    """Raised when a backtest's requested range/universe cannot support
    its requested horizons even after the engine's own bounding/truncation
    pass (T-1014-5 AC6) -- there is no partial history left to run
    against, so the request is rejected rather than silently shortened to
    nothing."""

    def __init__(self, message: str, available_sessions: int, required_sessions: int) -> None:
        super().__init__(message)
        self.available_sessions = available_sessions
        self.required_sessions = required_sessions
