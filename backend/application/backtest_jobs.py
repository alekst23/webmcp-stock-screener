"""In-memory backtest job lifecycle (T-1014-6): mints a stable `backtest_id`
immediately, tracks running/completed/failed state, and stores a completed
run's `BacktestResult` for read-only retrieval.

This is the structural half of "no silent rerun" (spec.md "Read backtest
results" / AC5, AC8): `BacktestJobStore` has no method that calls
`BacktestEngine.run` -- the only way a job's `result` field is ever set is
`complete()`, called exactly once by the route's background execution
(api/routes/backtest.py). Code holding only a `BacktestJobStore` has no
call it can make that produces fresh numbers under an existing id, the same
absence-of-a-rerun-call property `src/lib/screener/ports.ts`'s
`PinnedRunStore` documents for itself on the TS side.

Mirrors that same file's `RunNotAvailable` shape for the "not there"
outcome (`reason: 'unknown' | 'evicted'`), so both the backend job store and
the browser-side pinned-run store describe the same retention concept the
same way.
"""

from __future__ import annotations

import itertools
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from domain.models.backtest import BacktestRequest, BacktestResult

# Bounds how many completed/failed jobs this process holds at once (AC8's
# "results need a stated retention/expiry story"). A `running` job is never
# evicted regardless of this bound -- only finished jobs count against it.
MAX_STORED_BACKTESTS = 50

# How many evicted ids are remembered so a later read can say "evicted"
# rather than the less honest "unknown" -- bounded so this, too, cannot grow
# without limit over a long-lived process.
MAX_REMEMBERED_EVICTIONS = 500

BacktestStatus = Literal["running", "completed", "failed"]


@dataclass
class BacktestJob:
    backtest_id: str
    status: BacktestStatus
    request: BacktestRequest
    started_at: datetime
    finished_at: datetime | None = None
    result: BacktestResult | None = None
    error: str | None = None


@dataclass(frozen=True)
class BacktestJobNotAvailable:
    """Distinguishes "never existed" from "existed and was reclaimed" --
    mirrors ports.ts's `RunNotAvailable`. Neither case starts an evaluation
    to cover for the missing result (AC8)."""

    backtest_id: str
    reason: Literal["unknown", "evicted"]
    message: str

    available: bool = field(default=False, init=False)


class BacktestJobStore:
    """Not thread-safe beyond what a single asyncio event loop's cooperative
    scheduling already gives every dict mutation here (no `await` inside a
    method) -- every route call happens on the same loop, matching this
    program's other single-process in-memory stores (PinnedRunStore's
    Python-side counterpart)."""

    def __init__(self, max_jobs: int = MAX_STORED_BACKTESTS) -> None:
        self._max_jobs = max_jobs
        self._jobs: OrderedDict[str, BacktestJob] = OrderedDict()
        self._evicted: OrderedDict[str, None] = OrderedDict()
        self._seq = itertools.count(1)

    def create(self, request: BacktestRequest, now: datetime | None = None) -> BacktestJob:
        backtest_id = f"backtest_{next(self._seq)}"
        job = BacktestJob(
            backtest_id=backtest_id,
            status="running",
            request=request,
            started_at=now or datetime.now(timezone.utc),
        )
        self._jobs[backtest_id] = job
        return job

    def complete(
        self, backtest_id: str, result: BacktestResult, now: datetime | None = None
    ) -> None:
        self._finish(backtest_id, status="completed", result=result, now=now)

    def fail(self, backtest_id: str, error: str, now: datetime | None = None) -> None:
        self._finish(backtest_id, status="failed", error=error, now=now)

    def _finish(
        self,
        backtest_id: str,
        *,
        status: BacktestStatus,
        result: BacktestResult | None = None,
        error: str | None = None,
        now: datetime | None = None,
    ) -> None:
        job = self._jobs.get(backtest_id)
        if job is None:
            return
        job.status = status
        job.result = result
        job.error = error
        job.finished_at = now or datetime.now(timezone.utc)
        self._evict_if_needed()

    def get(self, backtest_id: str) -> BacktestJob | BacktestJobNotAvailable:
        job = self._jobs.get(backtest_id)
        if job is not None:
            # Move-to-end on read too, so a backtest a caller keeps
            # re-reading is the last one evicted -- LRU over both write and
            # read activity, not insertion order alone.
            self._jobs.move_to_end(backtest_id)
            return job
        reason: Literal["unknown", "evicted"] = (
            "evicted" if backtest_id in self._evicted else "unknown"
        )
        message = (
            f"Backtest {backtest_id} is no longer retained; its results were reclaimed. "
            "Start a new backtest_screener call for current numbers."
            if reason == "evicted"
            else f"No backtest found with id {backtest_id}."
        )
        return BacktestJobNotAvailable(backtest_id=backtest_id, reason=reason, message=message)

    def _evict_if_needed(self) -> None:
        finished_ids = [bid for bid, job in self._jobs.items() if job.status != "running"]
        while len(finished_ids) > self._max_jobs:
            oldest = finished_ids.pop(0)
            del self._jobs[oldest]
            self._evicted[oldest] = None
            if len(self._evicted) > MAX_REMEMBERED_EVICTIONS:
                self._evicted.popitem(last=False)
