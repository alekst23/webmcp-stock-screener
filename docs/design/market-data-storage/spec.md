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

The design must hold at the **full US listed universe on free-tier
hosting**: ~6,268 tickers (NASDAQ 3,690 + NYSE 2,321 + AMEX 257) across
10+ years — roughly 12M ticker-days — served from a 512 MB instance.
Memory use must be bounded by the working set of a query, not by the
size of the panel.

## Features

1. **Load the panel without materializing it.** Reading the panel costs
   memory proportional to what is read, not to the panel's size.
2. **Append a trading day** at a cost proportional to that day, not to
   the accumulated panel.
3. **Address the panel by ticker** so a query reads only the partitions
   it needs.
4. **Evaluate a search without full residency** — stream the universe so
   peak memory is one partition, whatever the universe's size.
5. **Disclose the panel's true state** — as-of date, coverage, and any
   degradation — wherever results are presented.

## Behavioral Specifications

### Loading the panel

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a panel for the full universe in object storage | the backend starts | the service becomes ready and reports the panel's real as-of date, coverage, and ticker count |
| Bounded cost | a panel an order of magnitude larger than the instance's memory | the backend starts and serves queries | it neither exceeds its memory budget nor fails; memory tracks the query's working set, not the panel |
| Growth | a universe that has doubled in tickers or years | the backend starts | startup memory is materially unchanged; only latency and storage grow |
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
| Bounded memory | a universe far larger than memory | a search runs | peak memory stays within budget throughout; the search completes rather than being killed |
| Concurrency | a search already running | a second arrives | both complete within budget; neither is starved nor causes the other to exceed it |

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
object store.

---

*Implemented by: EPIC-1016*
