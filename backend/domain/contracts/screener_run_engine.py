"""The screener-run engine's contract (T-0025-2). Implemented by
`domain.screener_run_engine.PortScreenerRunEngine`; consumed by
`api.routes.screener`. Domain layer -- imports nothing from infra. Mirrors
`domain.contracts.backtest_engine.BacktestEngine`'s single-method shape.
"""

from __future__ import annotations

from typing import Protocol

from domain.models.screener_run import ScreenerRunRequest, ScreenerRunResult


class ScreenerRunEngine(Protocol):
    """Narrows a universe, resolves fields, evaluates the filter tree,
    ranks, and returns a bounded result set -- or reports why it refused
    to, without raising. Stateless: the same request always reproduces the
    same problems/output (T-0025-2 AC7)."""

    def run(self, request: ScreenerRunRequest) -> ScreenerRunResult:
        ...
