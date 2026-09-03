"""The liquidity/price/history floor that defines the enforced ticker universe.

Resolved by the user against `docs/reference/universe-scope-analysis.md`:
median 60-session dollar volume >= $25,000,000, last close >= $1, >= 252
sessions (1 year) of history. This module holds only the rule -- thresholds
and a pure eligibility predicate, no pandas, no I/O -- so the rule itself is
unit-testable in isolation from how its inputs are computed from a panel
frame (`infra/universe_eligibility.py`).
"""

from __future__ import annotations

# Median (close * volume) over the panel's most recent DOLLAR_VOLUME_WINDOW_SESSIONS
# distinct session dates must clear this bar.
DOLLAR_VOLUME_FLOOR_USD = 25_000_000.0

# Trailing window the dollar-volume median is computed over.
DOLLAR_VOLUME_WINDOW_SESSIONS = 60

# The ticker's most recent close must be at least this.
PRICE_FLOOR_USD = 1.0

# The ticker must have at least this many rows (trading sessions) of history.
HISTORY_FLOOR_SESSIONS = 252


def passes_floor(median_dollar_volume: float, last_close: float, history_sessions: int) -> bool:
    """Whether one ticker's measured stats clear the enforced universe floor.

    All three conditions must hold; any one alone is not sufficient -- see
    docs/reference/universe-scope-analysis.md section 4 for why price and
    history contribute little on their own, and dollar volume does the real
    work.
    """
    return (
        median_dollar_volume >= DOLLAR_VOLUME_FLOOR_USD
        and last_close >= PRICE_FLOOR_USD
        and history_sessions >= HISTORY_FLOOR_SESSIONS
    )


def diff_eligibility(previous: set[str], current: set[str]) -> tuple[set[str], set[str]]:
    """(promoted, demoted) -- tickers that entered vs. left the eligible set.

    A promotion can only ever be a ticker that was already resident in the
    panel (e.g. one previously demoted whose stats recovered before its
    trailing window aged out): a ticker never admitted to the panel has no
    history to prove it clears the floor, so it cannot appear here. See
    docs/plan/EPIC-0016/T-0016-13-universe-enforcement.md's promotion-policy
    section for why that is a deliberate limitation, not an oversight.
    """
    return current - previous, previous - current
