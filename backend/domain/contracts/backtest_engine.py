"""The backtest engine's contract (T-1014-5). Implemented by
`domain.backtest_engine.PortBacktestEngine`; consumed by T-1014-6's job
lifecycle. Domain layer -- imports nothing from infra.
"""

from __future__ import annotations

from typing import Protocol

from domain.models.backtest import BacktestRequest, BacktestResult


class BacktestEngine(Protocol):
    """Evaluates a screener definition against history and returns match
    frequency, forward-return distributions, drawdown statistics, and the
    survivorship/lookahead/provenance disclosures every result must
    carry."""

    def run(self, request: BacktestRequest) -> BacktestResult:
        """Raises domain.errors.InsufficientHistoryError when the
        requested range/universe cannot support the requested horizons
        even after truncation."""
        ...
