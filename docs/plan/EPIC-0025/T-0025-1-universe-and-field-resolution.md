# T-0025-1: Universe and field resolution for server-side evaluation

**Epic**: EPIC-0025 (Server-Side Screener Evaluation Endpoint)
**Design**: docs/design/screener-core/
**Status**: Done
**Depends on**: —
**Blocks**: T-0025-2

## Description

Two data gaps block a correct evaluation, independent of the endpoint
that will use them:

1. No catalog field expresses "percent change over the last N sessions" —
   the exact shape the MVP's flagship ranking needs ("highest gains in
   the past 48 hrs" ≈ 2 daily sessions, since the price pipeline is
   daily-bars-only).
2. Sector and market-cap universe narrowing has schema
   (`UniverseSpec.sectors`, `.market_cap`) but nothing resolves it — the
   metadata is already loaded (`backend/domain/models/universe.py`, via
   `scripts/load_universe_metadata.py`), it's just never read by universe
   resolution.

This ticket closes both, as pure resolution logic with no HTTP surface
yet — T-0025-2 wires them into the endpoint.

## User Story

As the screener evaluation endpoint,
I want a field resolver for session-over-session percent change and a
universe filter that honors sector/market-cap, both backed by data
already loaded,
so that evaluation can express and narrow on the two dimensions the MVP
use case needs.

## Acceptance Criteria

1. A new catalog field (`field.price.change_pct`, parameterized by
   `lookback_sessions`) resolves to the percent change between an
   instrument's close price `lookback_sessions` sessions ago and its most
   recent close, computed as a vectorized window over the price panel —
   not a per-instrument scalar fetch.
2. An instrument with fewer stored sessions than `lookback_sessions`
   resolves this field as not-evaluable (`None`), which the existing
   per-condition fold treats as fails-closed — it does not raise or abort
   the run.
3. Universe resolution filters candidates by `sectors` (any-of) and
   `market_cap` (minimum floor) using the already-loaded static metadata,
   with the same precedence the existing universe spec documents
   (exclusions always win over an inclusion that would otherwise add the
   same member).
4. A sector value in the request that matches nothing in the loaded
   metadata is reported as an unrecognized-value problem (surfaced by
   T-0025-2's validation), not silently dropped from the universe.
5. Neither addition requires a new external data source — both are
   computed from data already loaded (the price panel; the universe
   metadata CSV import).

## Out of Scope

- Fundamentals-based fields (P/E, revenue) — no source exists
  (`NoFundamentalsPort`); not part of this ticket or this epic.
- The HTTP endpoint itself (T-0025-2).

## Implementation Plan

Design/test gates skipped for this ticket (`--skip-design-gate`) per project
convention (EPIC-1007/1009/1011/1013): the ACs above are already specific
enough to implement against directly; review is the gap-catching step.

1. **`domain/models/screener.py`**: add `sectors: list[str] | None = None`
   to `UniverseSpec`, update its docstring (currently says "no
   sectors/industries/indexes/exchanges").

2. **`domain/contracts/market_data.py`**: add a new, additive
   `SectorCatalog` Protocol (`unrecognized_sectors(sectors: list[str]) ->
   list[str]`). Deliberately *not* added to the existing `ReferenceDataPort`
   Protocol — that would force `test_backtest_engine.py`'s
   `FakeReferenceDataPort` (and any other structural implementer) to grow a
   method it has no use for. A separate Protocol is additive and zero-risk.

3. **`infra/panel_market_data.py`** (`PanelReferenceDataPort`):
   - Rename `_passes_liquidity` -> `_passes_criteria` (it now checks more
     than liquidity) and add a sector any-of check against
     `self._universe_meta[ticker].sector`. Exclusion-wins-over-inclusion
     already holds structurally — `get_universe_members` filters
     `excluded_tickers` in its own generator, before `_passes_criteria` is
     even called, so an excluded ticker never reaches the sector/liquidity
     check no matter what else would have included it. No change needed
     there, just confirmed by a test.
   - Add `unrecognized_sectors(self, sectors: list[str]) -> list[str]`
     (implements the new `SectorCatalog` Protocol): compares requested
     sector strings against the set of sector values actually present in
     `self._universe_meta`.
   - Add `field.price.change_pct` resolution inside `get_series`.
     **Design decision**: `ScalarCondition`/`RangeCondition`/`RelativeCondition`
     (and the new `RankingField`, T-0025-2) carry only `field_id: str` — no
     params dict — and `filter_evaluation.py`'s `_evaluate_scalar`/
     `_evaluate_range`/`_evaluate_relative` call
     `resolver.value_at(ticker, condition.field_id, {}, as_of)` with a
     hardcoded empty params dict. Only `SeriesComparisonCondition`'s
     `SeriesRef` threads real params. Changing `filter_evaluation.py`'s
     Condition models to carry params is out of this ticket's "pure
     resolution logic" scope and would ripple into already-passing tests.
     So `lookback_sessions` is expressed **two ways**, both landing on the
     same computation:
     - `catalog_id == "field.price.change_pct"` + `params["lookback_sessions"]`
       (works today for `series_comparison`, where `SeriesRef.params` is
       already threaded through).
     - `catalog_id == "field.price.change_pct_{N}"` (e.g.
       `field.price.change_pct_2`) — the lookback baked into the id itself,
       for `scalar`/`range`/`relative` conditions and ranking fields, none
       of which thread params today.
   - Computation is vectorized per AC1: for a ticker's row range covering
     `[from_date, to_date]`, build the lookback row-position array in one
     numpy op (`positions - lookback_sessions`), mask positions that fall
     before the ticker's own first stored row (insufficient history -> that
     date's observation is dropped, i.e. not-evaluable), then compute
     `(current - past) / past * 100` over the whole masked array at once —
     never a per-bar Python-level `close_at()` loop.
   - AC2 (fails-closed on insufficient history): dropping the date from the
     returned `list[SeriesObservation]` is exactly `get_series`'s existing
     "not evaluable" contract (see `test_get_series_unrecognized_catalog_id_returns_empty_not_error`)
     — `_value_at` in `backtest_engine.py` (and the new screener engine)
     already turns an empty `get_series` result into `None`, which
     `filter_evaluation.py` already folds to `False`/fails-closed. No
     change needed in `filter_evaluation.py` at all.

4. **Tests** (`tests/unit/test_panel_market_data.py`, extending the existing
   `TestPanelReferenceDataPort`/`TestPanelPriceSeriesPort` classes, same
   bare-fixture style as today — no new mocking machinery):
   - sectors any-of filtering; sector + market_cap combined; exclusion still
     wins over a sector match.
   - `unrecognized_sectors` against loaded metadata.
   - `change_pct` resolves via both the `params` form and the `_{N}` suffix
     form; matches a hand-computed percent change.
   - insufficient history (fewer stored sessions than `lookback_sessions`)
     -> empty `get_series` result (AC2).
