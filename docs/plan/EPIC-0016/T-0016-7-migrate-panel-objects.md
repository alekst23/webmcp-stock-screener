# T-0016-7: Backfill the real panel directly into S3

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open
**Depends on**: T-0016-3, T-0016-4
**Blocks**: T-0016-8, T-0016-9
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Retargeted -- read this before the rest of the doc

This ticket was written as "migrate panel objects from R2 to S3": copy
existing bytes from Cloudflare R2 into the new S3 bucket, verify
byte-identity, leave R2 as a rollback source. That is the wrong plan for
this project's actual state. Evidence gathered before any quota was spent:

- No root `.env` exists on this machine, and the `backend/.env` present has
  only `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_DEFAULT`, and `EODHD_API_KEY` --
  no `R2_BUCKET_NAME` / `R2_ENDPOINT_URL` / `R2_ACCESS_KEY_ID` /
  `R2_SECRET_ACCESS_KEY` / `R2_TOKEN_VALUE` anywhere reachable from this
  worktree. There is no R2 endpoint this ticket could even connect to.
- `docs/plan/project.md`'s own Decisions Log records the real history: an
  R2 bucket was created and credentials existed in a gitignored root `.env`
  at one point (2026-09-01), but the very next logged decision that day is
  "Built T-0001-9's full pipeline against fixtures rather than waiting for
  the API key, deferring only the live backfill run and the AC5 spot-check."
  No entry anywhere records that live backfill ever actually running.
  `docs/plan/project.md`'s Blockers table is explicit: "Land EPIC-0013's
  T-0013-1/T-0013-2 before attempting the backfill" -- and those merged to
  `main` only today (`08cc403`), on this same branch's ancestry.
- The target S3 bucket was confirmed empty by direct check (`HeadObject` on
  both `panel.parquet` and `universe.csv` -> 404; `ListObjectsV2` -> zero
  keys) before any write.

Conclusion: there is no panel in R2 to migrate. R2 was never actually
populated with real EODHD data -- only planned, credentialed at one point,
and then deferred. Migrating zero bytes is not a ticket; running the
backfill this project has been blocked on since T-0001-9 AC1 is. The user
approved retargeting this ticket to do exactly that, which also directly
satisfies EPIC-0001's T-0001-9 AC1 (real backfill) and unblocks its AC5
(live spot-check).

## Description

The panel and universe-metadata objects the deployed service reads
(`backend/application/load_panel.py`'s `PANEL_KEY` / `UNIVERSE_KEY`) do not
exist anywhere yet -- not in R2, not in S3. `backend/scripts/backfill_panel.py`
and `backend/application/backfill_panel.py` already implement the fetch
against EODHD's per-ticker range endpoint (one paid call per ticker) and the
Parquet write; what has never run is the live call against the real API key
and the real store.

Done looks like: a real, EODHD-sourced panel and its universe metadata
written to the S3 bucket T-0016-4 provisioned, readable back through
T-0016-3's provider-neutral `S3PanelStore` on the default AWS credential
chain (no static keys), and verified to actually answer a representative
pattern query at a stated resident size and peak RSS.

## User Story

As the person unblocking the AWS deployment and T-0001-9 AC1,
I want a real backfill run against a deliberately scoped universe, written
straight to the new S3 bucket,
so that the AWS deployment has real data to serve instead of an empty
bucket degrading to the mock panel, without first paying for a migration of
bytes that were never written.

## Acceptance Criteria

1. The universe scope (ticker count, history length) is decided and stated
   *before* any EODHD call is made, with an explicit justification against
   the epic's resolved 2 GB memory ceiling (Decision #3 in
   `docs/plan/EPIC-0016/_epic.md`) using the epic's own measured figures.
2. `backend/scripts/backfill_panel.py --dry-run` (or equivalent) reports the
   projected call count and output size for the chosen scope before any
   paid call is made.
3. The live backfill runs against the real EODHD key (from SSM, never
   printed or logged) and writes `panel.parquet` and `universe.csv` to
   `webmcp-panel-prod-490284589142` at exactly the keys the app's IAM policy
   is scoped to.
4. The objects are read back through `S3PanelStore`
   (`backend/infra/object_store.py`) using the default AWS credential chain
   -- no `OBJECT_STORE_ACCESS_KEY_ID` / `OBJECT_STORE_SECRET_ACCESS_KEY` set
   -- proving the app's actual runtime path (instance/task role, T-0016-3)
   works end to end, not just that the bytes exist.
5. The resulting panel is loaded and a representative pattern query is run
   against it (`scripts/measure_universe_scale.py` or equivalent), reporting
   row count, resident size, and observed absolute peak RSS, with real
   command output.
6. No large local artifact from the run is left behind; disk usage
   (`df -h /`) is reported before and after.
7. The backend CI gate passes at no regression from this branch's baseline
   (123 passed, 5 skipped).

## Design References

- `backend/application/load_panel.py` -- `PANEL_KEY` / `UNIVERSE_KEY`, and
  the fallback-to-mock behavior a populated bucket now supersedes
- `backend/scripts/backfill_panel.py`, `backend/application/backfill_panel.py`
  -- the backfill CLI and its `backfill_panel()` use case; `PANEL_KEY`
- `backend/scripts/load_universe_metadata.py`,
  `backend/infra/nasdaq_screener.py` -- how `universe.csv` (sector/market
  cap) is produced and uploaded
- `backend/infra/object_store.py` -- T-0016-3's provider-neutral
  `S3PanelStore`; default credential chain when no static keys are set
- `backend/scripts/measure_universe_scale.py` -- the harness for AC5, built
  for exactly this: load a real panel file and measure load/steady-state/
  search peak RSS in one process
- `docs/reference/data-provider.md` -- EODHD plan, quota, and per-ticker
  vs. bulk endpoint cost
- `docs/plan/EPIC-0016/_epic.md` -- Decision #3's 723 MB / +65% figures,
  the number this ticket's scope has to fit under with headroom
- T-0016-4 -- the destination bucket (private, versioned, SSE-S3)

## Solution Approach

**Universe source.** `backend/infra/nasdaq_screener.py` parses a Nasdaq
screener CSV export for sector/market-cap metadata; the project's normal
path is a manual browser download. The same data is available from Nasdaq's
public screener API (`api.nasdaq.com/api/screener/stocks?...&download=true`)
at no cost and no EODHD quota, so that is the source used here: fetched
live, filtered to exclude preferred shares (`^` in the symbol), warrants,
and rights, then ranked by market cap.

**Scope decision: 2,000 tickers (liquidity floor by market cap) x 5 years.**
This is not an arbitrary round number -- it is chosen to exactly match the
scope the epic's own Decision #3 already measured absolute peak RSS against:
"723 MB absolute peak RSS on a 2,000-ticker x 5-year panel with a realistic
3-step/4-study pattern," growing "+65% going from a simple pattern to a
complex one on the same panel." That puts a real-pattern worst case at
roughly 723 MB x 1.65 ~= 1.19 GB against the 2 GB ceiling -- about 850 MB of
headroom, a ~1.7x safety factor, on the *exact* scope already used to
justify the ceiling itself, rather than an extrapolation to an unmeasured
shape. Choosing a different ticker count or history length would mean
re-deriving that justification from a formula (83 MB fixed + ~120 B/row)
calibrated on a *different*, more pessimistic synthetic pattern; staying at
the measured point is the lower-risk choice.

The market-cap floor (~$2.5B cutoff at rank 2,000 of ~5,600 tickers with a
reported market cap, out of ~7,150 candidate US-listed common-stock
symbols) is also a legitimate product choice independent of sizing: the
project's Decisions Log already records that a liquidity/market-cap floor
belongs in the universe on base-rate-quality grounds, not only as a memory
workaround.

**Same ticker set for both objects.** The 2,000 tickers selected are used
for both `universe.csv` (sector/market cap metadata) and `panel.parquet`
(price history), via `backfill_panel.py --from-metadata`, so the two
objects describe the same universe rather than drifting apart.

**Call cost.** One EODHD call per ticker regardless of history length (the
per-ticker range endpoint returns any span in one call), so 2,000 tickers
is ~2,000 calls -- well inside the 100,000/day cap and roughly half the
~4,000-4,500 estimated for the full ~6,268-ticker listed universe.

## Out of Scope

Migrating anything from R2 -- there is nothing there to migrate. Trimming
or re-deriving the universe scope after this run (that is a product
decision, revisited only if the user asks). The nightly delta job
(T-0016-8, depends on this ticket's objects existing). Any change to the
panel's format, partitioning, or the engine's public surface.
