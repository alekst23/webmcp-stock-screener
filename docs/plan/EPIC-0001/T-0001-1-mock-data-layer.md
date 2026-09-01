# T-0001-1: Mock data layer

**Epic**: EPIC-0001 (WebMCP Pattern Research Workbench)
**Status**: Done
**Depends on**: —
**Blocks**: T-0001-2, T-0001-3
**Issue**: #1

## Description

Before any paid data is pulled, the project needs a synthetic OHLCV
dataset that mirrors the shape and conventions the real backfill will
eventually produce, so every downstream component (engine, WebMCP tools,
frontend) can be built and tested against realistic data at zero cost. A
small real-data sample, pulled from a free access tier, validates that the
synthetic dataset's structure actually matches reality before it becomes
load-bearing for the rest of the build.

## User Story

As a developer building the query engine and frontend,
I want a synthetic price dataset with known, hand-verifiable patterns and
the same structure the real data will have,
so that I can build and test the rest of the system before paying for the
real backfill.

## Acceptance Criteria

1. A synthetic dataset of daily adjusted OHLCV bars exists for a small set
   of tickers spanning multiple years, structured so it can stand in for
   the real dataset without requiring code changes elsewhere later.
2. The dataset includes several deliberately constructed instances of a
   known multi-step temporal pattern (e.g., a gap up, followed by several
   days of range contraction, followed by a breakout) at known ticker/date
   locations, so a temporal pattern matcher's output can be checked against
   a hand-computed expected result.
3. A small real-data sample (a handful of tickers) is pulled from the
   eventual real data source's free access tier and compared against the
   synthetic dataset's structure to confirm field names, value conventions
   (e.g., split/dividend adjustment), and date handling match what the real
   backfill will later produce.
4. Any mismatch found between the synthetic dataset and the real sample is
   corrected in the synthetic dataset before this ticket is considered
   done.
5. Regenerating the dataset is reproducible — its shape and guaranteed
   pattern instances do not change between runs.

## Design References

- `docs/plan.md` — data volume estimates, panel schema decisions
- `docs/reference/data-provider.md` — real data source's field conventions
  to match
- `docs/design/pattern-research-workbench/spec.md` — "Instance search"
  scenarios this ticket's known pattern instances exist to test
- `docs/design/pattern-research-workbench/technical.md` — `PriceBar` contract

## Solution Approach

Establishes the panel **schema** shared by the mock generator now and the
real EODHD pipeline later (T-0001-9) — the swap only works if both conform
to the same shape. Mostly a standalone generator script, not application
logic: `backend/scripts/generate_mock_panel.py` produces a small (~20-30
ticker) synthetic universe as Parquet, with a fixed set of hand-authored
known pattern instances (documented as a plain fixture list, not a domain
model, since they exist purely for T-0001-3's tests to assert against). A
second script pulls a handful of real tickers from EODHD's free tier (no
payment needed — free tier covers roughly a year of history, enough to
check field shapes) and diffs its structure against the synthetic schema.

**Contracts introduced:** `PriceBar` (`backend/domain/models/price.py`) —
one adjusted daily OHLCV row: ticker, date, open/high/low/close, volume.
The row shape both pipelines must produce.

**Config vars introduced:** `EODHD_API_KEY` — free-tier key, used only by
the schema sanity-check script, documented in `backend/.env.example` with
an empty placeholder. Not the paid key (that's T-0001-9's concern).

## Technical Considerations

Keep the synthetic universe small (a few dozen tickers). This is a
development/test fixture, not a stand-in for the full-universe launch — it
does not need to be large or complete.

## Out of Scope

The real paid backfill and nightly delta job (T-0001-9).

## Implementation Notes

- `backend/scripts/generate_mock_panel.py` builds a 25-ticker (`MOCK01`-`MOCK25`),
  2023-01-03 to 2025-12-31 synthetic panel as `PriceBar` rows, written to
  `backend/data/mock/panel.parquet`. All randomness flows through one
  `numpy.random.default_rng(seed)` consumed in a fixed order, so a given
  seed always reproduces byte-identical output (AC5).
- `backend/scripts/known_pattern_instances.py` hand-authors 3 known
  gap-up -> range-contraction -> breakout instances at fixed ticker/date
  locations (`MOCK01`/2023-06-05, `MOCK02`/2024-03-04, `MOCK03`/2025-01-13),
  for T-0001-3's temporal-matcher tests to assert against (AC2).
- **Mismatch found and corrected (AC3/AC4):** EODHD's per-ticker EOD
  endpoint returns raw `close` plus a separately back-adjusted
  `adjusted_close`, but does **not** return adjusted `open`/`high`/`low` —
  only `close` is adjusted directly. Naively mapping EODHD's raw
  open/high/low onto `PriceBar` (which commits every OHLC field to the
  adjusted basis) would put O/H/L on a different price basis than C across
  any split or ex-dividend date. `backend/scripts/fetch_eodhd_sample.py`'s
  `eodhd_row_to_price_bar` corrects this by scaling open/high/low by the
  same `adjusted_close / close` ratio that produced the adjusted close.
  Verified by `tests/functional/test_price_schema_conformance.py` against
  a realistic EODHD row fixture (no live API key available in this
  environment — see `backend/.env.example`).
