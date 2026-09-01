"""Known synthetic instances of the "gap up -> range contraction -> breakout"
temporal pattern, hand-placed by generate_mock_panel.py at these exact
ticker/date locations.

This is a plain fixture list, not a domain model: it exists purely so
T-0001-3's temporal-matcher tests have a hand-computed expected result to
assert against (`find_instances` on the matching setup must return exactly
these anchor dates, no more, no less). It is not consumed by application code.

Pattern shape (6 consecutive trading days per instance):
    day 0       gap_date          gap up >= 5% from the prior close
    day 1-4     contraction_dates  daily high-low range strictly narrows
    day 5       breakout_date     close breaks above the contraction window's
                                  highest high

The dates below are the literal source of truth: generate_mock_panel.py
looks up these exact (ticker, date) pairs in its generated trading calendar
and overwrites those rows with hand-authored OHLCV values, rather than
deriving the dates from array indices, so this list stays stable across
generator changes.
"""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class KnownPatternInstance:
    """One hand-authored occurrence of the gap/contraction/breakout setup."""

    ticker: str
    gap_date: date
    contraction_dates: tuple[date, date, date, date]
    breakout_date: date


KNOWN_PATTERN_INSTANCES: list[KnownPatternInstance] = [
    KnownPatternInstance(
        ticker="MOCK01",
        gap_date=date(2023, 6, 5),
        contraction_dates=(
            date(2023, 6, 6),
            date(2023, 6, 7),
            date(2023, 6, 8),
            date(2023, 6, 9),
        ),
        breakout_date=date(2023, 6, 12),
    ),
    KnownPatternInstance(
        ticker="MOCK02",
        gap_date=date(2024, 3, 4),
        contraction_dates=(
            date(2024, 3, 5),
            date(2024, 3, 6),
            date(2024, 3, 7),
            date(2024, 3, 8),
        ),
        breakout_date=date(2024, 3, 11),
    ),
    KnownPatternInstance(
        ticker="MOCK03",
        gap_date=date(2025, 1, 13),
        contraction_dates=(
            date(2025, 1, 14),
            date(2025, 1, 15),
            date(2025, 1, 16),
            date(2025, 1, 17),
        ),
        breakout_date=date(2025, 1, 20),
    ),
]
