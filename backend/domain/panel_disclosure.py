"""What to say about the panel behind a result.

Serve and disclose: a stale or partial panel still answers, but never as
though it were current and complete. The rule is applied per request rather
than at load, so a panel that catches up -- or a partition that becomes
readable again on the next boot -- stops being reported as degraded on its
own, with no intervention and no restart.
"""

from __future__ import annotations

from datetime import date

from domain.models.panel import PanelStatus
from domain.trading_calendar import previous_weekday, sessions_between

# Sessions the panel may fall behind before that is worth saying out loud.
# One missed weekday is routine -- a market holiday, or the job running before
# the provider publishes. Three in a row is the nightly job having stopped.
STALE_AFTER_SESSIONS = 3

# Ticker ranges named individually before the notice starts summarizing. Long
# enough to identify a gap, short enough to stay a sentence.
_MAX_NAMED_RANGES = 3


def disclose(status: PanelStatus, today: date) -> PanelStatus:
    """The panel's status with its degradation filled in as of `today`."""
    behind = len(sessions_between(status.as_of, previous_weekday(today)))
    stale = behind >= STALE_AFTER_SESSIONS
    disclosed: PanelStatus = status.model_copy(
        update={
            "is_stale": stale,
            "sessions_behind": behind,
            "notices": _notices(status, behind if stale else 0),
        }
    )
    return disclosed


def _notices(status: PanelStatus, behind: int) -> list[str]:
    notices: list[str] = []
    if status.is_synthetic:
        notices.append("Synthetic demo data — not real market data.")
    if behind:
        notices.append(
            f"Panel is {behind} sessions behind: the newest bar is {status.as_of}. "
            "Results describe the market up to that date, not today."
        )
    if status.missing:
        notices.append(
            f"Universe incomplete: {len(status.missing)} ticker "
            f"{'range' if len(status.missing) == 1 else 'ranges'} could not be read "
            f"({_named(status.missing)}). Matches in those tickers are missing from "
            "these results."
        )
    return notices


def _named(missing: list[str]) -> str:
    if len(missing) <= _MAX_NAMED_RANGES:
        return ", ".join(missing)
    shown = ", ".join(missing[:_MAX_NAMED_RANGES])
    return f"{shown} and {len(missing) - _MAX_NAMED_RANGES} more"
