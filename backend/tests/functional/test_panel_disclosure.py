"""T-0013-5: serve what is there, and say what is wrong with it.

Every degradation below is reachable without object storage, which is the
point of AC6: a failure mode that can only be produced in production is one
nobody exercises until it happens.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

import main as main_module
from application.load_panel import PANEL_KEY, load_panel
from domain.errors import PanelStoreError
from domain.models.panel import PanelStatus
from domain.panel_disclosure import STALE_AFTER_SESSIONS, disclose
from domain.trading_calendar import previous_weekday
from infra.panel_io import EPOCH_ORDINAL, PANEL_COLUMNS, table_to_parquet_bytes
from tests.mocks.fake_panel_store import InMemoryPanelStore

TODAY = date(2026, 9, 2)  # a Wednesday
_TICKERS = [f"T{index:03d}" for index in range(60)]
_DAYS = 2_000
_DAMAGED_GROUP = 2


def _as_of_behind(sessions: int) -> date:
    """The as-of date of a panel exactly `sessions` sessions behind today."""
    day = previous_weekday(TODAY)
    for _ in range(sessions):
        day = previous_weekday(day)
    return day


def _status(as_of: date, **overrides: object) -> PanelStatus:
    base = PanelStatus(
        as_of=as_of,
        first_date=date(2015, 1, 5),
        ticker_count=2_000,
        row_count=5_000_000,
        source="object-store",
    )
    updated: PanelStatus = base.model_copy(update=overrides)
    return updated


def _panel_bytes() -> bytes:
    rows = len(_TICKERS) * _DAYS
    origin = date(2015, 1, 5).toordinal() - EPOCH_ORDINAL
    dates = np.tile(np.arange(origin, origin + _DAYS, dtype=np.int32), len(_TICKERS))
    prices = np.linspace(10.0, 500.0, rows, dtype=np.float64)
    table = pa.Table.from_arrays(
        [
            pa.array(np.repeat(np.array(_TICKERS, dtype=object), _DAYS), type=pa.string()),
            pa.array(dates).cast(pa.date32()),
            pa.array(prices),
            pa.array(prices + 1.0),
            pa.array(prices - 1.0),
            pa.array(prices + 0.5),
            pa.array(np.full(rows, 1_000_000, dtype=np.int64)),
        ],
        names=PANEL_COLUMNS,
    )
    return table_to_parquet_bytes(table)


@pytest.fixture(scope="module")
def panel() -> bytes:
    return _panel_bytes()


@pytest.fixture(scope="module")
def damaged_panel(panel: bytes) -> bytes:
    """One row group's column chunk overwritten, located through the file's
    own metadata so the damage lands where it is meant to.

    The footer survives, which is why the loader can still name the tickers it
    lost -- their range is in the statistics, not in the pages that broke.
    """
    reader = pq.ParquetFile(pa.BufferReader(pa.py_buffer(panel)))
    chunk = reader.metadata.row_group(_DAMAGED_GROUP).column(PANEL_COLUMNS.index("open"))
    data = bytearray(panel)
    start = chunk.data_page_offset
    data[start : start + chunk.total_compressed_size] = b"\xff" * chunk.total_compressed_size
    return bytes(data)


class TestStaleness:
    def test_a_panel_that_has_fallen_behind_is_served_and_named_as_stale(self) -> None:
        # AC1: the answer still comes, with its true as-of date attached.
        status = _status(as_of=date(2026, 8, 20))

        disclosed = disclose(status, today=TODAY)

        assert disclosed.is_stale, f"expected stale, got {disclosed}"
        assert disclosed.sessions_behind == 8, f"got {disclosed.sessions_behind}"
        assert disclosed.row_count == status.row_count, "a stale panel is still served"
        assert any(
            "2026-08-20" in notice for notice in disclosed.notices
        ), f"the true as-of date must appear in the notice: {disclosed.notices}"

    def test_one_missed_session_is_not_stale(self) -> None:
        # A market holiday leaves the panel a session behind by design; saying
        # "stale" every long weekend would train people to ignore the notice.
        disclosed = disclose(_status(as_of=_as_of_behind(1)), today=TODAY)

        assert not disclosed.is_stale, f"one missed session is routine: {disclosed}"
        assert disclosed.notices == [], f"got {disclosed.notices}"

    def test_the_threshold_is_the_documented_one(self) -> None:
        at = disclose(_status(as_of=_as_of_behind(STALE_AFTER_SESSIONS)), today=TODAY)
        under = disclose(_status(as_of=_as_of_behind(STALE_AFTER_SESSIONS - 1)), today=TODAY)

        assert at.sessions_behind == STALE_AFTER_SESSIONS, f"got {at.sessions_behind}"
        assert at.is_stale, f"expected stale at the threshold: {at}"
        assert not under.is_stale, f"expected not stale one session under: {under}"

    def test_the_notice_clears_once_the_panel_catches_up(self) -> None:
        # AC5: nothing to reset, nothing to restart -- the notice is computed
        # from the panel's own as-of date on every request.
        stale = _status(as_of=date(2026, 8, 20))
        assert disclose(stale, today=TODAY).is_stale, "precondition"

        caught_up = stale.model_copy(update={"as_of": previous_weekday(TODAY)})

        disclosed = disclose(caught_up, today=TODAY)
        assert not disclosed.is_stale, f"got {disclosed}"
        assert disclosed.notices == [], f"got {disclosed.notices}"


class TestSyntheticData:
    def test_synthetic_data_is_named_wherever_the_status_is_read(self) -> None:
        # AC3.
        disclosed = disclose(
            _status(as_of=previous_weekday(TODAY), source="mock", is_synthetic=True), today=TODAY
        )

        assert any(
            "Synthetic" in notice for notice in disclosed.notices
        ), f"got {disclosed.notices}"

    def test_the_mock_panel_loads_as_synthetic(self, tmp_path: Path) -> None:
        path = tmp_path / "panel.parquet"
        path.write_bytes(_panel_bytes())

        loaded = load_panel(None, mock_path=path)

        assert loaded is not None, "expected the mock panel to load"
        assert loaded.status.is_synthetic, f"got {loaded.status}"


class TestPartialCoverage:
    def test_a_panel_with_an_unreadable_partition_still_serves_the_rest(
        self, damaged_panel: bytes
    ) -> None:
        # AC2: results are still produced, and the notice says which part of
        # the universe is not in them.
        store = InMemoryPanelStore({PANEL_KEY: damaged_panel})

        loaded = load_panel(store, mock_path=main_module.PANEL_PATH)

        assert loaded is not None, "a damaged panel must still load what it can"
        assert loaded.status.missing, "the lost tickers must be named"
        assert loaded.status.row_count < len(_TICKERS) * _DAYS, "expected rows to be missing"
        assert loaded.status.row_count > 0, "expected the intact row groups to survive"

        disclosed = disclose(loaded.status, today=TODAY)
        notice = " ".join(disclosed.notices)
        assert "incomplete" in notice, f"got {disclosed.notices}"
        assert loaded.status.missing[0] in notice, f"got {disclosed.notices}"

    def test_an_intact_panel_reports_no_missing_coverage(self, panel: bytes) -> None:
        store = InMemoryPanelStore({PANEL_KEY: panel})

        loaded = load_panel(store, mock_path=main_module.PANEL_PATH)

        assert loaded is not None, "expected the panel to load"
        assert loaded.status.missing == [], f"got {loaded.status.missing}"
        assert loaded.status.row_count == len(_TICKERS) * _DAYS, f"got {loaded.status.row_count}"


class TestUnreachableStore:
    """T-0016-3 AC4: a configured store that cannot be reached must abort
    startup rather than degrade to the mock panel -- the silent-mock hazard
    a role-based AWS deploy would otherwise hit invisibly."""

    def test_an_unreachable_store_raises_instead_of_falling_back_to_mock(
        self, tmp_path: Path
    ) -> None:
        store = InMemoryPanelStore({PANEL_KEY: _panel_bytes()})

        def _unreachable() -> None:
            raise PanelStoreError("Object store bucket 'wrong-bucket' is not reachable")

        store.ensure_reachable = _unreachable  # type: ignore[method-assign]
        mock_path = tmp_path / "panel.parquet"
        mock_path.write_bytes(_panel_bytes())

        with pytest.raises(PanelStoreError) as caught:
            load_panel(store, mock_path=mock_path)

        assert "wrong-bucket" in str(caught.value), f"expected the bucket named, got {caught.value}"


class TestRequireRealPanel:
    """T-0016-12: REQUIRE_REAL_PANEL is the opt-in guard so a production
    deploy refuses to start on the mock panel rather than serve it as though
    it were real. Off by default -- every local checkout and the rest of
    this suite call `load_panel` without the flag and must be unaffected."""

    def test_strict_and_unconfigured_refuses_to_start_naming_the_bucket_var(
        self, tmp_path: Path
    ) -> None:
        # A directory stands in for the mock path: reading it as bytes
        # raises IsADirectoryError. If the guard did not refuse to start
        # before ever reaching the mock fallback, this test would see that
        # exception instead of PanelStoreError, rather than passing by luck.
        poison_mock_path = tmp_path

        with pytest.raises(PanelStoreError) as caught:
            load_panel(None, mock_path=poison_mock_path, require_object_store=True)

        assert "OBJECT_STORE_BUCKET" in str(
            caught.value
        ), f"expected the unset variable named, got {caught.value}"

    def test_strict_and_configured_and_reachable_loads_the_real_panel(self, panel: bytes) -> None:
        # AC4: a properly configured production deploy must start exactly as
        # it does today -- the flag must not add friction to the happy path.
        store = InMemoryPanelStore({PANEL_KEY: panel})

        loaded = load_panel(store, mock_path=main_module.PANEL_PATH, require_object_store=True)

        assert loaded is not None, "expected the real panel to load"
        assert not loaded.status.is_synthetic, f"expected the real panel, got {loaded.status}"

    def test_strict_and_unreachable_store_still_fails_through_ensure_reachable(
        self, tmp_path: Path
    ) -> None:
        # AC5: the flag must not add a second, competing failure path --
        # ensure_reachable's existing error is what must surface, unchanged.
        store = InMemoryPanelStore({PANEL_KEY: _panel_bytes()})

        def _unreachable() -> None:
            raise PanelStoreError("Object store bucket 'wrong-bucket' is not reachable")

        store.ensure_reachable = _unreachable  # type: ignore[method-assign]
        mock_path = tmp_path / "panel.parquet"
        mock_path.write_bytes(_panel_bytes())

        with pytest.raises(PanelStoreError) as caught:
            load_panel(store, mock_path=mock_path, require_object_store=True)

        assert "wrong-bucket" in str(caught.value), f"expected the bucket named, got {caught.value}"

    def test_strict_off_by_default_still_falls_back_to_mock(self, tmp_path: Path) -> None:
        # Pins today's local-dev/test-suite path: calling load_panel exactly
        # as every other test in this suite does must be unaffected.
        mock_path = tmp_path / "panel.parquet"
        mock_path.write_bytes(_panel_bytes())

        loaded = load_panel(None, mock_path=mock_path)

        assert loaded is not None, "expected the default (non-strict) mock fallback to still work"
        assert loaded.status.is_synthetic, f"got {loaded.status}"


class TestNothingLoadable:
    def test_an_unreadable_panel_with_no_fallback_loads_nothing(self, tmp_path: Path) -> None:
        store = InMemoryPanelStore({PANEL_KEY: b"this is not a parquet file"})

        loaded = load_panel(store, mock_path=tmp_path / "absent.parquet")

        assert loaded is None, f"expected no panel at all, got {loaded}"

    def test_the_request_fails_naming_the_panel_as_the_cause(self) -> None:
        # AC4: "the engine is broken" and "there is no price data" are
        # different problems and must not read the same.
        app = main_module.app
        app.state.engine = None
        app.state.panel_status = None

        with TestClient(app) as client:
            app.state.engine = None
            app.state.panel_status = None
            response = client.get("/api/research/panel")

        assert response.status_code == 503, f"got {response.status_code}"
        detail = response.json()["detail"]
        assert "price panel" in detail, f"the error must name the panel: {detail}"
