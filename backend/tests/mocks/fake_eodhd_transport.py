"""A stub `requests` transport carrying recorded EODHD response shapes.

Tests drive the real `infra/eodhd_client.EodhdClient` through this rather
than substituting a hand-written fake PriceSource, so the request building
and row mapping under test are the same code the paid backfill will run.
The row shape is the one pinned in
tests/functional/test_price_schema_conformance.py -- EODHD's documented EOD
format, with `adjusted_close` deliberately differing from `close`.
"""

from __future__ import annotations

from typing import Any


def eod_row(
    day: str,
    close: float,
    adjusted_close: float | None = None,
    volume: int = 1_000_000,
) -> dict[str, Any]:
    """One per-ticker EOD row. `adjusted_close` defaults to a 1% back
    adjustment so a test that ignores the adjustment factor fails."""
    return {
        "date": day,
        "open": close * 0.99,
        "high": close * 1.01,
        "low": close * 0.98,
        "close": close,
        "adjusted_close": adjusted_close if adjusted_close is not None else close * 0.99,
        "volume": volume,
    }


def bulk_row(code: str, day: str, close: float, volume: int = 1_000_000) -> dict[str, Any]:
    """One bulk-by-exchange row: the per-ticker shape plus the `code` naming
    the ticker, since a bulk response spans a whole exchange."""
    return {**eod_row(day, close, volume=volume), "code": code}


class _StubResponse:
    def __init__(self, payload: Any, status_error: Exception | None = None) -> None:
        self._payload = payload
        self._status_error = status_error

    def raise_for_status(self) -> None:
        if self._status_error is not None:
            raise self._status_error

    def json(self) -> Any:
        return self._payload


class StubSession:
    """Serves recorded payloads keyed by the path suffix of the request URL."""

    def __init__(self, payloads: dict[str, Any], error: Exception | None = None) -> None:
        self._payloads = payloads
        self._error = error
        self.requests: list[tuple[str, dict[str, Any]]] = []

    def get(self, url: str, params: dict[str, Any], timeout: int) -> _StubResponse:
        self.requests.append((url, params))
        if self._error is not None:
            raise self._error
        for suffix, payload in self._payloads.items():
            if url.endswith(suffix):
                return _StubResponse(payload)
        return _StubResponse([])
