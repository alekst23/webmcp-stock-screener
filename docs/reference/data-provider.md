# Data Provider: EODHD

Research date: 2026-08-26. Verify pricing/limits at
[eodhd.com/pricing](https://eodhd.com/pricing) before relying on these
numbers — they're a provider's published rates, not a contract.

## What we use it for

EODHD is an **ingestion-time data source**, not a runtime dependency. It
feeds a one-time backfill plus a nightly delta into our own panel storage
(Parquet, on a Render persistent disk). The app never calls EODHD live
during a user's search — `findInstances`, `measure`, `showGrid`, etc. always
read our own stored panel via the FastAPI service. See
[`docs/plan.md`](../plan.md) for the full architecture.

## Plan

**EOD Historical Data — All World**, $19.99/mo ($16.58/mo billed annually).

- 100,000 API calls/day, 1,000 requests/minute
- 30+ years of historical EOD data, US + global exchanges
- Includes bulk EOD endpoint access (not available on the Free plan)

Sector/market-cap metadata and earnings dates are **not** covered by this
tier (they live on the pricier Fundamentals tier, $59.99/mo) — sourced
separately, see below.

## Two endpoints, two jobs

| Job | Endpoint | Cost | Frequency |
|---|---|---|---|
| One-time backfill | Per-ticker EOD history, e.g. `from=2016-01-01&to=2026-08-25` | 1 API call per ticker, any date range | Once (rerun only to rebuild the base panel) |
| Nightly delta | Bulk-by-exchange-by-day (whole market, one day) | 100 quota units | Every night, via cron |

**Backfill:** ~4,000–4,500 tickers × 1 call each ≈ 4,000–4,500 calls total —
fits well inside the 100,000/day cap; the 1,000 req/min limit means a full
backfill finishes in minutes, not days. (An earlier estimate assumed the
bulk endpoint had to be used for backfill too, which would have meant a
multi-day quota-limited pull — that was wrong. The per-ticker endpoint
returns any length of history in a single call.)

**Nightly delta:** one bulk-by-exchange call per exchange per night ≈ 100
quota units — trivial against the daily cap.

## Data volume

Universe: ~4,200 tickers (midpoint estimate) × ~2,520 trading days (10
years) = up to ~10.6M ticker-days; realistically ~9M once accounting for
tickers with shorter listing history.

Our stored panel format (not EODHD's wire format): 20 bytes/ticker-day
(OHLC adjusted, int32 each, + volume as uint32). Date is not stored
per-row — US equities share one trading calendar, stored once as a shared
lookup table.

| | Rows | Raw | Compressed (brotli) |
|---|---|---|---|
| Initial backfill | ~9–10.6M ticker-days | ~180–210 MB | ~60–90 MB (final Parquet size on disk) |
| Nightly delta | ~4,200 ticker-days | ~85 KB | ~20–30 KB |
| Metadata (tickers/sectors/mcap) | ~4,200 rows | <1 MB JSON | <200 KB |

What crosses the wire *from* EODHD during backfill is larger than what we
end up storing — their API returns verbose JSON (repeated field names,
text-formatted floats) at roughly 100–130 bytes/row uncompressed, so backfill
pulls something like 1–1.4 GB of JSON (likely gzipped in transit by their
API to a few hundred MB). One-time cost to the ingestion script; irrelevant
to end users and the demo, which never touch EODHD directly.

The client browser never downloads the panel at all — it only ever
receives small, per-query slices (e.g. a 12-instance × 40-day grid ≈
9.6 KB), fetched from our own edge API.

## Metadata sourced elsewhere

| Data | Source | Notes |
|---|---|---|
| Sector / market cap | Nasdaq screener export (free CSV) | Static enough not to need a live feed; one-time/occasional pull |
| Earnings dates | Not yet finalized | Nice-to-have for `days_since_earnings`; not a blocker. Evaluate a free earnings-calendar source separately if time allows — do not let this hold up the OHLCV pipeline |

## Storage: object storage, not a Render disk

The backfilled panel and its nightly delta persist in Cloudflare R2 (free
tier covers this size, zero egress) or S3 (~$0.02/GB/mo), not a Render
persistent disk. Decided during T-1001-8's deployment: Render requires a
paid instance tier (~$25/mo) just to attach a disk, which costs far more
than the object storage this data volume actually needs. The backend
fetches the panel into memory/`/tmp` on startup; the nightly cron job
downloads, appends, re-uploads.

## Open items

- Confirm the bulk-by-exchange endpoint's exact per-call payload shape and
  whether it needs pagination for large exchanges before wiring the nightly
  cron.
- Store the EODHD API key as a Render environment secret — never commit
  it. See `.gitignore` (`.env*` is excluded).
- Same for R2/S3 credentials once chosen — Render environment secret,
  never committed.
