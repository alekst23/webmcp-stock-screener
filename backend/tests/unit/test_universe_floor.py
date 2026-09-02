"""T-0016-13: domain/universe_floor.py -- the enforced universe floor as a
pure rule, tested in isolation from how its inputs are measured from a
panel (infra/universe_eligibility.py, tested separately)."""

from __future__ import annotations

from domain.universe_floor import (
    DOLLAR_VOLUME_FLOOR_USD,
    HISTORY_FLOOR_SESSIONS,
    PRICE_FLOOR_USD,
    diff_eligibility,
    passes_floor,
)


class TestPassesFloor:
    def test_a_ticker_clearing_all_three_thresholds_passes(self) -> None:
        result = passes_floor(DOLLAR_VOLUME_FLOOR_USD, PRICE_FLOOR_USD, HISTORY_FLOOR_SESSIONS)

        assert result is True, "the floor's own threshold values must themselves pass (>=, not >)"

    def test_dollar_volume_just_under_the_floor_fails(self) -> None:
        result = passes_floor(DOLLAR_VOLUME_FLOOR_USD - 1.0, 100.0, 1_000)

        assert result is False, f"expected False $1 under the dollar-volume floor, got {result}"

    def test_price_just_under_the_floor_fails(self) -> None:
        result = passes_floor(1_000_000_000.0, PRICE_FLOOR_USD - 0.01, 1_000)

        assert result is False, f"expected False $0.01 under the price floor, got {result}"

    def test_history_one_session_short_fails(self) -> None:
        result = passes_floor(1_000_000_000.0, 100.0, HISTORY_FLOOR_SESSIONS - 1)

        assert result is False, f"expected False one session short of the floor, got {result}"

    def test_clearing_dollar_volume_and_price_but_not_history_still_fails(self) -> None:
        # All three must hold -- no single strong metric compensates for a
        # weak one. See docs/reference/universe-scope-analysis.md section 4.
        result = passes_floor(1_000_000_000.0, 500.0, 10)

        assert result is False, f"expected False with only 10 sessions of history, got {result}"


class TestDiffEligibility:
    def test_a_ticker_that_enters_the_set_is_reported_promoted(self) -> None:
        promoted, demoted = diff_eligibility({"AAA"}, {"AAA", "BBB"})

        assert promoted == {"BBB"}, f"expected BBB promoted, got {promoted}"
        assert demoted == set(), f"expected no demotions, got {demoted}"

    def test_a_ticker_that_leaves_the_set_is_reported_demoted(self) -> None:
        promoted, demoted = diff_eligibility({"AAA", "BBB"}, {"AAA"})

        assert demoted == {"BBB"}, f"expected BBB demoted, got {demoted}"
        assert promoted == set(), f"expected no promotions, got {promoted}"

    def test_an_unchanged_set_reports_neither(self) -> None:
        promoted, demoted = diff_eligibility({"AAA"}, {"AAA"})

        assert promoted == set() and demoted == set(), f"got promoted={promoted}, demoted={demoted}"
