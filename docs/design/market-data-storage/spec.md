# Market Data Storage — Product Spec

## Intent

Pattern research is only as credible as the data underneath it. This
feature owns how the historical price panel is stored, loaded, and
queried — so that research runs against the *whole* listed universe
rather than whatever subset happens to fit in memory, and so a
researcher is never shown partial or stale data as though it were
current and complete.

The panel is not a fixed asset. It grows with every trading day, every
exchange added, and every extension of history. Storage must therefore
be sized by the *query*, not by the dataset: adding tickers or years
must not move the app closer to failing.

This feature does not own what a pattern *means* or how it is matched —
that belongs to the pattern research workbench. It owns the substrate
those queries run on.

## Preconditions

- A historical daily OHLCV panel exists for the target universe,
  produced by the EODHD pipeline and persisted in object storage
  (Cloudflare R2). See `docs/reference/data-provider.md`.
- The engine's row contract (`PriceBar`) and query surface
  (`PatternResearchEngine`) are unchanged by this feature — how rows are
  stored is not what a row *is*.

## Target

This is a **proof-of-concept architecture**, sized deliberately rather
than sized to whatever fits by accident.

The panel holds a **trimmed liquid universe** — on the order of 2,000
US listed common stocks over 10+ years (~5M ticker-days, ~130 MB
resident) — served from a 512 MB instance with real headroom for query
working memory. Trimming is a product choice as much as a sizing one:
microcap and thinly-traded names distort pattern base rates, so a
liquidity floor improves the research as well as the footprint.

The panel stays fully resident, and the design accepts that residency
grows with universe x history. What it does *not* accept is cost that
grows faster than the data: no per-row objects, no index larger than
what it indexes, no whole-panel work to append one day.

**The prod-grade answer to unbounded growth is a database, not a
bespoke scanner.** When this universe stops fitting, the move is
DuckDB-over-R2 or a real time-series store — not a hand-rolled chunked
reader, which would be a query engine built to be thrown away. That
upgrade path is documented in `technical.md` and deliberately not
built here.

## Features

1. **Load the panel without materializing it.** Reading the panel costs
   memory proportional to what is read, not to the panel's size.
2. **Append a trading day** at a cost proportional to that day, not to
   the accumulated panel.
3. **Address the panel by ticker** so a query reads only the partitions
   it needs, and a filtered universe costs less than the whole one.
4. **Disclose the panel's true state** — as-of date, coverage, and any
   degradation — wherever results are presented.

## Behavioral Specifications

### Loading the panel

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a panel for the full universe in object storage | the backend starts | the service becomes ready and reports the panel's real as-of date, coverage, and ticker count |
| Bounded cost | a panel of the target universe | the backend starts and serves queries | resident memory is within budget with stated headroom, and no transient allocation exceeds the resident footprint |
| Growth | a universe that has doubled in tickers or years | the backend starts | memory grows proportionally to the data and no faster — no per-row objects, no super-linear index |
| Nothing loadable | object storage is unreachable and no local panel exists | a research request arrives | the request fails with an error naming the panel as the cause, not a generic failure |

### Keeping the panel current

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a panel current through the prior session | the nightly delta runs | the latest session's rows are added and the panel's as-of date advances |
| Idempotence | a panel already containing a session | that same session's delta is applied again | the panel is unchanged — one row per ticker-day, never a duplicate |
| Bounded cost | a panel of ~12M rows | one session (~6k rows) is appended | the work done is proportional to the session, not to the panel |
| Backfill gap | a panel whose last session predates the latest by several days | a catch-up runs | every missing session is added in order and the as-of date reflects the newest |

### Searching the universe

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a pattern and the full universe | the researcher searches | matches are found across the whole universe, and results are identical to those a fully-resident panel would produce |
| Filtered universe | a search restricted by sector or market cap | the researcher searches | only the partitions in that universe are read; excluded tickers cost nothing |
| Bounded memory | the target universe loaded | a search runs | peak memory stays within the instance budget throughout, with stated headroom |
| Concurrency | a search already running | a second arrives | both complete within budget; neither is starved nor causes the other to exceed it |
| Outgrowing the panel | a universe that no longer fits the budget | the panel is loaded | the failure is explicit and names the sizing as the cause, rather than the process being killed |

### Disclosing panel state

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a complete, current panel | results are presented | the panel's as-of date is visible wherever results are |
| Stale panel | a nightly delta that has not run for several sessions | results are presented | results are still served, and the panel is shown as stale with its true as-of date — never presented as current |
| Partial universe | some partitions unreadable | results are presented | results are served, and the researcher is told the universe searched was incomplete and which part was missing |
| Synthetic data | a mock panel rather than real market data | results are presented | the data is named as synthetic, so an illustrative result can never be mistaken for a real one |
| Recovery | a degraded panel that becomes complete again | results are presented | the degradation notice clears on its own, without intervention |

## Out of Scope

Intraday bars; fundamentals; corporate-action reconstruction beyond the
adjusted prices the provider supplies; multi-region replication of the
object store. Streaming or chunked evaluation, and any database-backed
store — both are the documented upgrade path, not this feature's scope.

---

*Implemented by: EPIC-0013*
