"""Weekday arithmetic, shared by the nightly job and by staleness reporting.

Market holidays are deliberately not modelled. The provider answers a holiday
with no rows, which the append path already treats as a no-op, and staleness
tolerates a couple of empty sessions before it says anything -- so a holiday
calendar here would be a second source of truth for something the data
already answers.
"""

from __future__ import annotations

from datetime import date


def previous_weekday(day: date) -> date:
    """The most recent weekday strictly before `day`."""
    current = day
    while True:
        current = date.fromordinal(current.toordinal() - 1)
        if current.weekday() < 5:
            return current


def sessions_between(after: date, through: date) -> list[date]:
    """Every weekday strictly after `after` and not after `through`."""
    days: list[date] = []
    current = after
    while current < through:
        current = date.fromordinal(current.toordinal() + 1)
        if current.weekday() < 5:
            days.append(current)
    return days
