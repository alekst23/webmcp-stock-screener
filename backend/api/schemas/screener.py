"""Request/response schemas for the screener-run HTTP boundary (T-0025-2).

`ScreenerRunRequestWire`/`ScreenerRunResponseWire` reuse
`domain.models.screener_run`'s models directly -- the same relationship
`api/schemas/backtest.py`'s `BacktestStartRequest = BacktestRequest` has to
its domain model. No reshaping needed: the request body IS a
`ScreenerRunRequest`, and the response IS a `ScreenerRunResult`.
"""

from __future__ import annotations

from domain.models.screener_run import ScreenerRunRequest, ScreenerRunResult

ScreenerRunRequestWire = ScreenerRunRequest
ScreenerRunResponseWire = ScreenerRunResult
