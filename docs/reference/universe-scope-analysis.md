# Universe scope analysis

Data-driven recommendation for the ticker universe floor, computed against
the real stored panel (`s3://webmcp-panel-prod-490284589142/panel.parquet`,
read-only). Method: `backend/scripts/analyze_universe_scope.py`, which
reads the panel exactly as the backend does (`infra/panel_io`,
`infra/panel_frame`), then runs the same T-0016-9 search patterns locally
against candidate-filtered subsets to get real match counts, which are used
to extrapolate peak memory from T-0016-9's measured container figures.

Snapshot analyzed: fetched 2026-09-01, `panel.parquet` 83,148,256 bytes
compressed (S3 `ContentLength`).

## 1. What is actually in the panel today

| metric | value |
|---|---|
| tickers | 50,565 |
| rows | 2,420,825 |
| date range | 2021-09-01 to 2026-09-01 |
| compressed size (S3) | 83,148,256 bytes (79.3 MiB) |
| resident size (parsed frame) | 73,017,245 bytes (69.6 MiB) |
| resident bytes/row | 30.16 |

This is the T-0016-8 accident described in the background: the nightly job's
bulk-by-exchange pull appends the *entire* US exchange, not the curated
1,999-ticker set. The evidence is in the shape of the data, not just the
ticker count. Rows-per-ticker is bimodal:

| percentile | rows/ticker |
|---|---|
| p0-p20 | 1 |
| p30-p90 | 2 |
| p100 (max) | 1,255 |
| mean | 47.9 |

The median ticker in the panel has **2 rows** of history. Only a small
cluster of tickers carries the full 5-year run:

| history floor | tickers below it (poisoned) | tickers at/above it |
|---|---|---|
| 60 sessions | 48,583 | 1,982 |
| 200 sessions (trend200's minimum) | 48,620 | 1,945 |
| 252 sessions (1 year) | 48,638 | 1,927 |
| 504 sessions (2 years) | 48,682 | 1,883 |

48,566 of the 50,565 tickers (96.0%) have fewer than 5 total rows and
together hold only 82,228 of the panel's 2,420,825 rows (3.4%). Every one of
these 50,565 tickers has at least one row inside the most recent 60-session
window (all were pulled by the same recent full-exchange append), so this is
not old delisted junk accumulating at the tail — it is a wide, shallow
one-time injection of nearly every US-listed symbol, most with only a
handful of very recent bars. Any study that needs real history (`trend200`
needs 200 bars; `sma(close, 200)` needs the same) silently produces `NaN` or
never resolves for 96% of the panel's tickers today. The ~1,945 tickers with
`>=200` rows are effectively the surviving "real" curated set, now slightly
larger than the original 1,999 because trading days have accrued since.

## 2. Median daily dollar volume (60-session window)

`close x volume`, median per ticker over the panel's most recent 60 distinct
session dates (market-wide window, not per-ticker last-60 — a stale ticker
with no rows in the window correctly reports no volume there rather than a
median computed from years-old activity).

Every one of the 50,565 tickers has at least one row in this window, but
32,717 (64.7%) show a **median of $0** (illiquid names, zero-volume days,
warrants/units, sub-penny issues); 17,848 have positive median dollar
volume.

| decile | median $ volume |
|---|---|
| p0-p60 | $0 |
| p70 | $3,738 |
| p80 | $176,112 |
| p90 | $3,291,571 |
| p100 (max) | $39.8B |

Survivor counts at candidate liquidity floors:

| floor | surviving tickers |
|---|---|
| $250,000 | 9,445 |
| $1,000,000 | 6,968 |
| $5,000,000 | 4,491 |
| $10,000,000 | 3,624 |
| $25,000,000 | 2,615 |
| $50,000,000 | 1,896 |

Even the loosest floor tested ($250k) already cuts 81% of the panel's
tickers — the dollar-volume distribution alone does most of the pruning
work, before price or history floors are applied at all.

## 3. Threshold table (dollar-volume floor only)

Resident-memory estimates use a model fit directly from the current panel:
numeric columns cost a fixed 24.0 bytes/row (date + OHLC + volume); the
ticker column costs 2 bytes/row (int16 category codes) up to 32,767
distinct tickers and 4 bytes/row above it (pandas' own dtype-promotion
rule), plus ~103.5 bytes per distinct ticker for the category dictionary
itself. **The current 50,565-ticker panel pays the int32 penalty** — that is
why its 30.16 B/row exceeds the docstring's designed 26.1 B/row target
(`infra/panel_frame.py`); every candidate below has well under 32,767
tickers and reverts to the cheaper 26 B/row-class figure.

| floor | tickers | rows | est. compressed size | est. resident size |
|---|---|---|---|---|
| $250,000 | 9,445 | 2,308,530 | 79,291,251 B (75.6 MiB) | 60,999,438 B (58.2 MiB) |
| $1,000,000 | 6,968 | 2,258,610 | 77,576,645 B (74.0 MiB) | 59,445,122 B (56.7 MiB) |
| $5,000,000 | 4,491 | 2,218,278 | 76,191,359 B (72.7 MiB) | 58,140,094 B (55.5 MiB) |
| $10,000,000 | 3,624 | 2,177,143 | 74,778,492 B (71.3 MiB) | 56,980,840 B (54.3 MiB) |
| $25,000,000 | 2,615 | 2,016,340 | 69,255,379 B (66.0 MiB) | 52,695,520 B (50.3 MiB) |
| $50,000,000 | 1,896 | 1,633,117 | 56,092,790 B (53.5 MiB) | 42,657,298 B (40.7 MiB) |

Note how little row count moves across this whole range (2.31M down to
1.63M) even as ticker count drops by 5x: nearly all of the panel's real
history sits in a fixed pool of ~1,900-3,600 tickers regardless of where the
liquidity floor lands within this band, because the 48,600+ tickers with
almost no history were never going to survive any floor above $0. Compressed
size scales by row-count proportion of the current file (an approximation —
Parquet's actual compression ratio can vary slightly with ticker mix — but
row count is the dominant driver and this is stated as an estimate, not a
measurement).

## 4. Crossing dollar volume with price and history floors

Combining a $1 price floor and a $5 price floor with 1-year (252 session)
and 2-year (504 session) history floors, at three dollar-volume floors:

| $ volume floor | price floor | history floor | tickers | rows |
|---|---|---|---|---|
| $1,000,000 | $1 | 1yr | 1,846 | 2,240,311 |
| $1,000,000 | $1 | 2yr | 1,803 | 2,224,447 |
| $1,000,000 | $5 | 1yr | 1,830 | 2,220,234 |
| $1,000,000 | $5 | 2yr | 1,787 | 2,204,370 |
| $5,000,000 | $1 | 1yr | 1,816 | 2,205,376 |
| $5,000,000 | $1 | 2yr | 1,775 | 2,190,354 |
| $5,000,000 | $5 | 1yr | 1,804 | 2,190,316 |
| $5,000,000 | $5 | 2yr | 1,763 | 2,175,294 |
| $10,000,000 | $1 | 1yr | 1,780 | 2,166,081 |
| $10,000,000 | $1 | 2yr | 1,744 | 2,152,933 |
| $10,000,000 | $5 | 1yr | 1,769 | 2,152,276 |
| $10,000,000 | $5 | 2yr | 1,733 | 2,139,128 |

Price floor moves survivor counts by only 1-2%: at these dollar-volume
levels, a $1+ price is nearly always already true (penny stocks rarely
clear $1M+ median daily dollar volume in the first place). History floor
and dollar-volume floor do essentially all of the work, and interact with
each other more than either interacts with price.

## 5. Memory consequence

**Extrapolation method.** For each candidate universe, the exact T-0016-9
search patterns (`simple` — one unfiltered condition, `close > sma(close,
50)`; `complex` — the 3-step/4-study realistic pattern) were run locally
against the candidate-filtered panel to get real anchor/match counts (this
machine, not the container — counts only, not an RSS measurement). Peak RSS
is then extrapolated as:

- `before_search = 122.2 MB (fixed app-import cost, doesn't scale with
  data) + (T-0016-9's measured before_search minus that same 122.2 MB) x
  (candidate resident bytes / T-0016-9's 60,990,506-byte resident panel)`
- `peak = before_search + candidate_matches x (T-0016-9's own peak-minus-
  before_search for that pattern, divided by that run's match count)`

**Uncertainty, stated plainly:** the per-match byte cost differs by ~40x
between the two patterns measured (759.9 B/match for the broad, unfiltered
pattern vs. 32,051 B/match for the realistic 3-step/4-study pattern), so
this only extrapolates safely for patterns structurally similar to the ones
T-0016-9 measured, using each candidate's own matching pattern type. It also
assumes linear scaling of decode/parse buffer overhead with panel size,
which was not independently verified — it is the same assumption T-0016-9's
own headroom reasoning relies on. Candidate universes here are close in size
to T-0016-9's panel (scale factors 0.92-0.96), which keeps the extrapolation
close to interpolation rather than a long-range projection.

| candidate | tickers | rows | worst case: simple/broad peak | headroom vs 2 GB | realistic: complex peak | headroom vs 2 GB |
|---|---|---|---|---|---|---|
| $1M / $1 / 1yr | 1,846 | 2,240,311 | 1,354.5 MB | 36.9% | 661.7 MB | 69.2% |
| $5M / $1 / 1yr | 1,816 | 2,205,376 | 1,335.4 MB | 37.8% | 648.7 MB | 69.8% |
| $10M / $1 / 1yr | 1,780 | 2,166,081 | 1,313.4 MB | 38.8% | 636.1 MB | 70.4% |
| $10M / $1 / 2yr | 1,744 | 2,152,933 | 1,307.2 MB | 39.1% | 633.6 MB | 70.5% |

All four candidates keep the worst case comfortably under 2 GB, and all
land at *better* headroom than T-0016-9's own measurement of the currently
deployed 1,999-ticker panel (34.3% headroom on the same simple/broad
pattern) — consistent, since every candidate here has fewer tickers and
comparable or fewer rows than that panel.

## 6. Recommendation

**Floor: median 60-session daily dollar volume >= $10,000,000, last close
>= $1, minimum 1 year (252 sessions) of history.**

Result: **1,780 tickers, 2,166,081 rows**, ~74.4 MB compressed (estimate),
~56.4 MB resident. Worst-case peak (broad, unfiltered search): **~1,313.4
MB, 38.8% headroom under the 2 GB ceiling.** Realistic pattern: ~636.1 MB,
70.4% headroom.

Reasoning:

- **Tradability.** $10M median daily dollar volume is a real liquidity bar
  — enough that a retail-sized order does not move the tape and fills are
  reliable — not just a market-cap proxy. Section 4 shows price and history
  contribute little on their own; dollar volume is the floor doing the real
  work, which is the metric that actually determines whether a pattern
  found by the screener is tradeable.
- **History floor set to 1 year, not 2.** A 2-year floor (1,744 tickers)
  looks nearly identical on paper, but it specifically excludes a set of
  large, highly liquid, currently-relevant tickers that only IPO'd or
  spun off in the last 12-20 months — among them SanDisk (SNDK, $22.5B
  median daily $ volume), CoreWeave (CRWV, $2.1B), Circle (CRCL, $0.8B),
  and Figma (FIG, $0.4B). These are exactly the names screener users are
  likely to search for. A 1-year floor (252 sessions) keeps them while
  still safely exceeding `trend200`'s 200-bar requirement.
- **Memory.** 38.8% headroom on the worst-case pattern beats the currently
  deployed panel's own measured 34.3%, and 70.4% headroom on the realistic
  pattern leaves ample room for concurrent requests.

**What is lost at this floor.** Of the 1,945 tickers with genuinely
substantial history (>=200 rows) in the current panel, 165 (8.5%) are cut:
18 for having less than a year of trading history, and 147 for falling
short of the $10M liquidity bar despite adequate history — close misses
clustered just under the line (e.g. BBUC $9.9M, AMBP $9.8M, LPL $9.8M,
AB $9.75M median daily dollar volume). These are genuine, tradeable small-
and mid-cap names; they are excluded because the screener's memory budget
and result-quality goals both favor a universe where every match is
liquid enough to act on, not because they are illiquid junk. If user
feedback shows this floor is too tight, $5M (1,816 tickers, section 4)
recovers most of them at almost no memory cost (37.8% vs. 38.8% worst-case
headroom).

## 7. Enforcement gap

Choosing a floor is not enough by itself — nothing in the current pipeline
applies one, and the accident that created the 50,565-ticker panel shows
exactly how it re-occurs:

- **`universe.csv`** (`infra/nasdaq_screener.py`, loaded by
  `application/load_panel.py::_load_universe`) is metadata-only today. It
  supplies `sector` / `market_cap` for `TickerMetadata` so the engine can
  narrow by those fields; it is never consulted to decide which tickers'
  price rows are allowed into `panel.parquet`, and a missing or empty
  `universe.csv` degrades gracefully to "no metadata filtering" rather than
  restricting the universe. It currently has no role in gating panel
  content at all.
- **The nightly delta** (`backend/scripts/nightly_delta.py` ->
  `backend/application/append_daily_delta.py`) calls
  `source.fetch_exchange_day(exchange, day)` for a whole exchange and
  appends every bar it gets back, unconditionally, via
  `infra/panel_append.py::merge_panel_parquet`. There is no filter step
  between "bulk response for the whole US exchange" and "rows written to
  the stored panel" — this is the exact mechanism that produced the
  current 50,565-ticker panel from a 1,999-ticker starting point, and it
  will do so again on the next nightly run regardless of what floor is
  chosen today.
- **Where a floor belongs.** Two places, both required, or the universe
  re-expands the first time either path runs alone:
  1. **Ingest** (`backend/application/backfill_panel.py` and any
     replacement/reset of `panel.parquet`) — the floor should be applied
     once, when building the panel from scratch, so the stored object never
     contains more than the chosen universe in the first place.
  2. **Nightly delta** (`backend/application/append_daily_delta.py`) — the
     bulk-by-exchange response must be filtered to the same ticker set
     *before* `merge_panel_parquet` is called, every night, or the panel
     re-accretes every excluded ticker one bar at a time. This is also
     where a *refresh* of the floor's ticker set belongs (dollar volume is
     not static — a ticker can cross $10M and should be added, or fall
     below it and arguably should stop accumulating new rows), which
     implies the floor needs to live as data (a maintained ticker list,
     plausibly `universe.csv` repurposed for this role, or a new object)
     rather than as a constant baked into the nightly script, so it can be
     recomputed periodically without a code deploy.

This ticket does not implement either change; it is scoped to the analysis
that should inform them.
