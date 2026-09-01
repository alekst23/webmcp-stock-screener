"""T-0016-5 AC6: an EODHD request failure must never leak the API key.

`api_token` travels as a query parameter (infra/eodhd_client.py), so any
HTTP-layer error that carries the resolved request URL -- exactly what
`requests.HTTPError` does -- carries the key too. This must not survive
into `PriceSourceError`'s message or its exception chain, since either can
end up in a script's failure output or a container's stderr log.
"""

from __future__ import annotations

import traceback
from datetime import date

import pytest
import requests

from domain.errors import PriceSourceError
from infra.eodhd_client import EodhdClient
from tests.mocks.fake_eodhd_transport import StubSession

_SECRET_KEY = "sk-do-not-leak-this-9f3a2b"


def _leaking_http_error() -> requests.HTTPError:
    # Mirrors what `Response.raise_for_status()` actually raises in
    # production: its message embeds the fully resolved URL, api_token
    # included, exactly as requests builds it from `params`.
    url = f"https://eodhd.com/api/eod-bulk-last-day/US?api_token={_SECRET_KEY}&fmt=json"
    return requests.HTTPError(f"401 Client Error: Unauthorized for url: {url}")


class TestEodhdClientFailureDoesNotLeakApiKey:
    def test_fetch_exchange_day_error_message_excludes_api_key(self) -> None:
        session = StubSession(payloads={}, error=_leaking_http_error())
        client = EodhdClient(_SECRET_KEY, session=session)

        with pytest.raises(PriceSourceError) as excinfo:
            client.fetch_exchange_day("US", date(2026, 9, 1))

        assert _SECRET_KEY not in str(
            excinfo.value
        ), f"API key leaked into PriceSourceError message: {excinfo.value!r}"

    def test_fetch_exchange_day_error_traceback_excludes_api_key(self) -> None:
        """The chained cause is what actually carries the key (via
        requests' HTTPError message); a bare `str(exc)` check would miss a
        leak that only shows up in a printed traceback or `logging.exception`."""
        session = StubSession(payloads={}, error=_leaking_http_error())
        client = EodhdClient(_SECRET_KEY, session=session)

        try:
            client.fetch_exchange_day("US", date(2026, 9, 1))
        except PriceSourceError as exc:
            rendered = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        else:
            pytest.fail("Expected PriceSourceError to be raised")

        assert (
            _SECRET_KEY not in rendered
        ), f"API key leaked into the exception's printed traceback/chain: {rendered!r}"
