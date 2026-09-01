# T-1001-9: Real data pipeline (paid, deferred)

**Epic**: EPIC-1001 (WebMCP Pattern Research Workbench)
**Status**: In Progress (implementation complete; awaiting the real backfill run)
**Depends on**: T-1001-1, T-1001-8
**Blocks**: T-1001-10
**Issue**: #1

## Description

With the design proven end-to-end against mock data, this ticket replaces
the mock dataset with real historical market data for the full target
universe of stocks, and establishes the ongoing process that keeps it
current. This is the first ticket in the project that incurs a real,
ongoing cost — it is deliberately sequenced as late as the dependency
graph allows.

## User Story

As a user (or their AI agent) researching a pattern,
I want the app to reflect real historical stock data across the full
target universe, kept reasonably current,
so that findings are meaningful rather than illustrative.

## Acceptance Criteria

1. Historical daily price data for the full intended universe of stocks,
   covering the intended history length, is loaded and available to the
   engine, replacing the mock dataset without requiring changes to the
   engine, tools, or frontend built in prior tickets.
2. An automated process keeps the dataset current by regularly adding the
   latest trading day's data without manual intervention.
3. Per-stock classification data (at minimum sector and a size bucket)
   needed for universe filtering is available and reasonably current.
4. The data's as-of date is visible somewhere a user would see it, so
   results are never presented as more current than they actually are.
5. A full example research session produces plausible, sane results
   against the real data, spot-checked against a small number of
   independently known real-world facts (e.g., a known historical earnings
   gap in a well-known stock).
6. This ticket is not started until the tickets it depends on are complete
   and verified.

## Design References

- `docs/reference/data-provider.md` — source, endpoints, cost, volume
- `docs/plan.md` — deferred-payment sequencing decision, survivorship-bias
  disclosure requirement

## Solution Approach

Replaces T-1001-1's mock `panel.parquet` with a real one built the same
way — same `PriceBar` schema (T-1001-1/T-1001-3), so nothing downstream
changes. Backfill uses EODHD's per-ticker range endpoint (1 API call per
ticker, any date length — confirmed in `data-provider.md`, not the
bulk-by-day endpoint, which is for the nightly delta only). Nightly delta
via the bulk-by-exchange endpoint as a Render Cron Job.

**Storage: object storage (R2 or S3), not a Render disk.** Discovered
during T-1001-8's deployment that Render's persistent disk requires a
paid instance tier (~$25/mo) just to attach it — far more than storing
~60-90MB of Parquet in Cloudflare R2 (free tier covers this size, zero
egress fees) or S3 (~$0.02/GB/mo). The backend fetches the panel from
object storage into memory/`/tmp` on startup instead of reading a mounted
disk path; the nightly cron job downloads, appends the day's delta, and
re-uploads. Keeps the Render Web Service on its existing free/cheap
compute tier — only the storage layer changes from what T-1001-8
originally sketched.

Sector/market-cap metadata comes from a free Nasdaq screener CSV export,
not EODHD (outside its plan). As-of date surfaces through a small addition
to `getWorkspace`'s response (or an adjacent endpoint) so the UI can
display it per spec.md's Preconditions.

**Contracts introduced:** `TickerMetadata` →
`backend/domain/models/universe.py` — `ticker`, `sector`, `market_cap`,
`as_of`.

**Config vars introduced:** reuses `EODHD_API_KEY` from T-1001-1, but the
underlying EODHD account must be upgraded to the paid EOD Historical Data
plan ($19.99/mo) for this ticket; the free tier used in T-1001-1 is
insufficient for full-universe/full-history backfill. This is an
account-tier change, not a different key. New: R2/S3 credentials + bucket
name for the panel object store (`sync: false`, set in Render dashboard,
never committed).

## Implementation Plan

Layering follows the project's hexagonal rule (domain never imports infra;
infra adapters return domain entities; use cases stay thin).

**Domain (new contracts)**

- `domain/models/panel.py` — `PanelStatus` (`as_of`, `first_date`,
  `ticker_count`, `row_count`, `source`): the panel's provenance, surfaced
  through the API for AC4.
- `domain/contracts/panel_store.py` — `PanelStore` Protocol
  (`object_exists` / `get_object` / `put_object`). Justified by a real test
  fake (`InMemoryPanelStore`) plus a critical external contract.
- `domain/contracts/price_source.py` — `PriceSource` Protocol
  (`fetch_history` for the per-ticker backfill, `fetch_exchange_day` for the
  nightly bulk delta).

**Infra (adapters)**

- `infra/eodhd_client.py` — owns `eodhd_row_to_price_bar` (moved here from
  `scripts/fetch_eodhd_sample.py`, which now re-exports it) and `EodhdClient`,
  the `PriceSource` implementation over the per-ticker range endpoint (1 call
  per ticker) and the bulk-by-exchange endpoint. Network errors chain into
  `PriceSourceError`.
- `infra/object_store.py` — `S3PanelStore`, a boto3 S3-API adapter that works
  against Cloudflare R2 (`R2_ENDPOINT_URL` + `auto` region). Errors chain into
  `PanelStoreError`.
- `infra/panel_io.py` — `bars_to_parquet_bytes` / `parquet_bytes_to_bars` /
  `panel_status`, the single place the Parquet wire format lives. Round-trips
  the exact `PriceBar` schema `scripts/generate_mock_panel.py` writes, so the
  engine, tools, and frontend need no change (AC1).
- `infra/nasdaq_screener.py` — `parse_screener_csv` → `dict[str,
  TickerMetadata]` for `findInstances`' `minMarketCap`/`sectors` filtering
  (AC3). Rows with unusable symbols are skipped; missing sector/market cap
  degrade to `None` rather than dropping the ticker.

**Application (use cases)**

- `application/backfill_panel.py` — fetch every ticker's full history, sort,
  serialize, upload (AC1).
- `application/append_daily_delta.py` — download panel, fetch one bulk
  exchange day, drop already-present `(ticker, date)` pairs, re-upload (AC2).
- `application/load_panel.py` — resolve the panel at startup: object store
  first, local mock path as fallback.

**Entry points**

- `scripts/backfill_panel.py` and `scripts/nightly_delta.py` — standalone
  CLIs. Both read `EODHD_API_KEY` and the R2 vars from the environment and
  exit non-zero with an explicit message naming the missing variable. No
  key is ever embedded or guessed.
- `scripts/load_universe_metadata.py` — uploads a Nasdaq screener CSV export
  to the object store.

**Memory: the real universe does not fit the naive representation**

Discovered while wiring this up, and structural enough to belong in this
ticket. The panel was built straight from `PriceBar.model_dump()`, giving an
object column of per-row ticker strings, an object column of per-row `date`
instances, and float64 OHLC -- ~141 bytes/row. At the verified 6,268-ticker
listed universe over 10 years (~12M ticker-days) that is ~1.7 GB, against the
free-tier web service's 512 MB. Worse, the engine's lazy `(ticker, date)`
lookup dictionaries would have added an index larger than the data.

`backend/infra/panel_frame.py` now owns the storage layout: ticker as a
pandas `category`, date as an int32 ordinal, OHLC as float32, volume as
uint32 -- **measured at 25.1 bytes/row** (~310 MB at 12M rows), and the
per-row dicts are replaced by a per-ticker row range plus a binary search,
which costs nothing per row. `PriceBar` and every public engine behavior are
unchanged; all pre-existing engine tests pass untouched.

Two deliberate deviations from the sizing note in data-provider.md: dates are
ordinals rather than offsets into a shared calendar (same 4 bytes, no side
table to thread through filtered views), and prices are float32 rather than
scaled int32 -- 4-decimal fixed-point needs a 10,000x scale that **overflows
int32 above $214,748**, and BRK.A trades near $712,000.

Universe scope and history length stay a decision for the human running the
backfill: `scripts/backfill_panel.py` takes `--exchanges`, `--from`, `--to`,
`--limit`, and `--dry-run` (which prints the projected ticker-days, resident
MB, and API-call count without spending a call).

**Wiring**

- `main.py` — `_load_engine()` loads the panel through
  `application/load_panel.py` (object store, else the existing mock path) and
  builds the engine with the universe metadata map; `app.state.panel_status`
  holds the `PanelStatus`.
- `api/routes/research.py` — `GET /api/research/panel` returns `PanelStatus`
  (AC4). Chosen over extending `getWorkspace`, which runs purely client-side
  and never touches the network — the Solution Approach's sanctioned
  "adjacent endpoint" option.
- `src/lib/workspace/panelStatus.ts` + `src/routes/+page.svelte` — fetch and
  render "Price data as of <date>", so results are never presented as more
  current than they are (AC4).
- `render.yaml` — a `cron` service running the nightly delta, plus the R2
  env vars (all `sync: false`).

**Verified endpoint facts** (confirmed live against the paid tier by the
orchestrating session, folded into `docs/reference/data-provider.md`): the
per-ticker EOD rows carry **no** ticker field (it comes from the request
URL); the bulk-by-exchange endpoint needs **no pagination** (44,557 US rows
in one call) but has a **different row shape** (adds `code`,
`exchange_short_name`), so the delta path has its own mapper; and
`/api/exchange-symbol-list/US` gives a better ticker list than the screener
CSV -- 6,268 real listings once OTC tiers are excluded, against the ~4,200
previously estimated.

**Testing without a live key.** Every test drives the pipeline through the
`PriceSource`/`PanelStore` fakes over the recorded EODHD row shape already
pinned in `tests/functional/test_price_schema_conformance.py`. No test makes
a network call, and no live full-universe backfill is run from this branch.

## Runbook: real-data spot check (AC5)

Cannot be executed until `EODHD_API_KEY` for the paid plan is present on the
machine running the backfill. Run this once, immediately after the first real
backfill, before treating any result as meaningful.

**0. Prerequisites**

```bash
export EODHD_API_KEY=...            # paid EOD Historical Data plan
export R2_BUCKET_NAME=... R2_ENDPOINT_URL=...
export R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
```

**1. Backfill and load**

```bash
cd backend
uv run python scripts/load_universe_metadata.py path/to/nasdaq_screener.csv
uv run python scripts/backfill_panel.py --from 2016-01-01
uv run uvicorn main:app          # startup log must report source="object-store"
curl -s localhost:8000/api/research/panel
```

Expect `source: "object-store"`, `ticker_count` in the 3,500–4,500 range, and
`as_of` within one or two trading days of today.

**2. Structural sanity**

- `row_count / ticker_count` should land near the number of trading days in
  the backfill range (~252/year), lower for recently listed tickers.
- No ticker may have a bar dated on a weekend or a US market holiday.
- Every bar must satisfy `low <= min(open, close) <= max(open, close) <= high`.

**3. Known real-world facts.** Each of these is independently checkable
against any public chart; all use split/dividend-adjusted closes, which is
the basis `PriceBar` commits to.

| Check | Expectation |
|---|---|
| `NVDA` 2024-06-07 → 2024-06-10 | 10-for-1 split. On an *adjusted* basis the close must be roughly continuous (a few percent), NOT a ~90% drop. A ~90% drop means the adjustment factor was not applied. |
| `AAPL` 2020-08-28 → 2020-08-31 | 4-for-1 split; same continuity check. |
| `META` 2022-02-02 → 2022-02-03 | ~-26% single-day close-to-close gap (Q4 2021 earnings). The largest one-day drop in the ticker's history. |
| `NFLX` 2022-04-19 → 2022-04-20 | ~-35% single-day close-to-close gap (Q1 2022 subscriber loss). |
| `GME` 2021-01-27 | Close near the all-time high, volume orders of magnitude above its own median. |
| Any ticker, 2020-03-16 | Large negative day across essentially the whole universe (COVID crash) — catches a universe-wide date-alignment error. |

**4. Full research session.** Through the deployed UI, with an agent driving
the WebMCP tools: define a gap study, define a 3-step setup (gap up → range
contraction → breakout), `findInstances` over 2016-01-01..today with
`minMarketCap` set, `sampleInstances`, `measure` at a 10-day horizon, then
`showGrid`. Results are plausible when: the instance count is in the
hundreds-to-thousands (not 0, and not millions), the measured median forward
return is within a few percent of the base rate rather than an implausible
double-digit edge, and the sampled charts visually show the pattern.

**5. Record the outcome** in this ticket under a "Spot check results"
heading — the actual numbers observed, not just pass/fail — before closing
the ticket.

## Technical Considerations

This is the paid step (~$20/month). Confirm explicit go-ahead before
incurring the cost if it has not already been given.

## Out of Scope

Historical fundamentals data; intraday data.
