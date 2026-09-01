# EPIC-0015: DuckDB Query Engine

**Depends on**: T-0013-3 (ticker-partitioned Parquet — branch
`epic/EPIC-0013-market-data-storage`, **unmerged**) — supplies the sorted,
row-group-pruned Parquet layout this engine reads. Nothing here can be
measured against a real layout until that branch lands on `main`.
**Blocks**: —
**Design**: `docs/design/duckdb-query-engine/technical.md`
(`spec.md` not written — run `/at-epic-design EPIC-0015`)
**Issue**: #15

> **Epic number deviates from the derivation rule.** Issue #15 derives
> `EPIC-1015`, which was already taken by "Legacy surface cutover" from the
> ten-epic Wave 0 batch. Renumbered to the next free number.

## Description

The pattern-research engine cannot serve real market data on a 512 MB
instance, and the panel is not why. Measured this session on a synthetic
2,000-ticker x 5-year panel (2.52M rows), as absolute process RSS — the
number Render actually kills on:

| moment | absolute RSS |
|---|---|
| bare interpreter | 14 MB |
| + numpy / pandas / pyarrow | 90 MB |
| + app imports | 100 MB |
| + whole Parquet file as a Python `bytes` | 217 MB |
| + parsed to the compact panel | 364 MB (**panel itself: 65.7 MB**) |
| before search | 385 MB |
| **peak during search** | **723.5 MB** |

A 66 MB dataset provokes a 723 MB peak. Worse, the peak tracks *expression
complexity*, not row count: the same panel searched with a simple
2-step / 0-study pattern grows 211 MB during search, and with a realistic
3-step / 4-composed-study pattern grows 348 MB — **+65% for the same rows**.
Trimming the universe does not fix a cost driven by how the question is
written.

Four causes, all in the evaluator rather than the storage:

1. `backend/infra/expression.py:197` — a study referenced by name is
   re-parsed and re-evaluated on every reference. Studies composed of
   studies multiply that.
2. `backend/infra/pandas_engine.py:123` — a list comprehension materializes
   every step's condition Series and holds them all simultaneously.
3. `backend/infra/expression.py:210` — every operand of an `and`/`or` is
   fully materialized before any combining; there is no incremental fold.
4. The rolling helpers (`sma`, `ema`, `highest`, `lowest`, `atr`,
   `days_since`) all go through `groupby(...).transform(lambda ...)`, which
   materializes a result per ticker group and then concatenates.

This epic replaces the evaluator and the matcher with SQL executed by DuckDB
directly over the R2-hosted Parquet, so intermediates live in a query
engine's own bounded, spillable memory instead of as simultaneous
whole-panel pandas Series. It is the rung-2 upgrade
`docs/design/market-data-storage/technical.md` designates, taken early.

`backend/domain/contracts/engine.py`'s `PatternResearchEngine` Protocol —
seven methods, verified unchanged on `main` — is the seam. The DuckDB engine
is a second implementation of that Protocol, selected at the composition
root. **The domain contract does not change.**

## User Story

As a researcher searching a real, liquid US equity universe,
I want a search's memory cost to be bounded by the query engine rather than
by how many studies my pattern composes,
so that writing a more expressive pattern does not kill the service.

## The trigger fired, for a different reason than written

`docs/design/market-data-storage/technical.md` sets the DuckDB trigger at
*"when resident memory at the target universe exceeds the instance budget's
headroom"*. Recorded honestly: **resident memory is fine.** The panel is
65.7 MB. What overruns the budget is evaluation transients. The written
trigger would never have fired; the condition it was a proxy for did. The
design doc's wording is wrong and this epic supersedes it — see
`docs/design/duckdb-query-engine/technical.md`.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-0015-1 | DuckDB session over R2 Parquet — credentials, pushdown, caching | — | Open |
| 2 | T-0015-2 | Compile validated expressions to SQL, with each study evaluated once | — | Open |
| 3 | T-0015-3 | Recursive `ema` in SQL | T-0015-2 | Open |
| 4 | T-0015-4 | Multi-step temporal matching in SQL | T-0015-2 | Open |
| 5 | T-0015-5 | DuckDB engine — study/setup definition and instance search | T-0015-1, T-0015-3, T-0015-4 | Open |
| 6 | T-0015-6 | DuckDB engine — sampling, measurement, splits, and windows | T-0015-5 | Open |
| 7 | T-0015-7 | Differential equivalence against the pandas engine | T-0015-6 | Open |
| 8 | T-0015-8 | Absolute-RSS memory verification against expression complexity | T-0015-6 | Open |
| 9 | T-0015-9 | Select and wire the engine at the composition root | T-0015-7, T-0015-8 | Open |

## Dependency Graph

```
T-0015-1 ────────────────────────┐
                                 │
                                 ├──> T-0015-5 ──> T-0015-6 ──┬──> T-0015-7 ──┐
T-0015-2 ──┬──> T-0015-3 ────────┤                            │               ├──> T-0015-9
           │                     │                            └──> T-0015-8 ──┘
           └──> T-0015-4 ────────┘
```

## Wave Plan

- **Wave 1** (parallel): T-0015-1, T-0015-2 — no dependencies. T-0015-2 is
  developed against a local Parquet file and needs no R2 access at all.
- **Wave 2** (parallel): T-0015-3, T-0015-4 — both extend the compiler.
- **Wave 3**: T-0015-5 — the adapter that assembles the pieces.
- **Wave 4**: T-0015-6 — the remaining four Protocol methods.
- **Wave 5** (parallel): T-0015-7, T-0015-8 — the two proofs. Neither
  changes behavior; both must pass before the engine is selectable.
- **Wave 6**: T-0015-9 — wiring.

The two proofs are deliberately last and deliberately separate. T-0015-7 is
what makes replacing a working, well-tested component defensible at all;
T-0015-8 is the only evidence that the replacement bought what it was
supposed to buy. Either one failing invalidates the epic, and neither can
run before the engine is complete.

## Acceptance Criteria

1. A second implementation of `PatternResearchEngine` exists that answers all
   seven contract methods by executing SQL, and `backend/domain/` is
   byte-for-byte unchanged by this epic.
2. For a corpus of setups covering every catalog function, both single- and
   multi-step patterns, `sustained` and non-`sustained` steps, and partial
   matches at the panel's trailing edge, the two engines return identical
   instance sets over the same panel — same tickers, same dates, same
   completeness values, same complete/partial counts.
3. Peak absolute process RSS during a whole-universe search is measured, not
   baseline-subtracted, and stays within a stated 512 MB budget with stated
   headroom at the target universe.
4. That peak grows by no more than a stated small fraction when the same
   panel is searched with a pattern of substantially greater expression
   complexity (more steps, more composed studies) — demonstrating the cost is
   no longer a function of how the question is written.
5. Which engine is serving, and why, is observable at runtime rather than
   inferable from configuration.
6. With no object-store credentials present, the application still boots and
   still serves the mock panel, exactly as it does today.

## Design References

- `docs/design/duckdb-query-engine/technical.md` — this epic's design: the
  corrected trigger, the SQL translation strategy, and the recorded
  disagreement over sequencing.
- `docs/design/market-data-storage/technical.md` (on
  `epic/EPIC-0013-market-data-storage`, unmerged) — the three-rung upgrade
  ladder that designates DuckDB as rung 2, and the trigger wording this epic
  corrects.
- `docs/plan/EPIC-0013/T-0013-3-ticker-partitioned-parquet.md` (same branch)
  — the partition layout, row-group sizing, and measured pruning fractions
  this engine reads against. Its "where pruning does not help" section is
  load-bearing for T-0015-1.
- `docs/plan/EPIC-0013/T-0013-6-verify-full-universe-scale.md` (same branch)
  — records the trigger as already fired, and the two options.
- `docs/plan/EPIC-0013/T-0013-4-streaming-universe-evaluation.md` (same
  branch) — the deferred alternative; see "Relationship to T-0013-4" below.
- `backend/domain/contracts/engine.py` — the seven-method Protocol that must
  not change.
- `backend/infra/expression.py` — the module docstring documents the
  `highest`/`lowest` strictly-before-today semantics and states that the
  `ast` whitelist is a safety boundary. Both must survive the port.

## Open Questions

Recorded rather than guessed. Each carries a recommended default so a ticket
can proceed without waiting, and so a different choice has to be argued for.
Full reasoning in `docs/design/duckdb-query-engine/technical.md`.

| # | Question | Recommended default | Owner |
|---|----------|---------------------|-------|
| 1 | How is `ema`'s recurrence evaluated — recursive CTE, Python UDF, or precomputation at ingest? | Recursive CTE, measured. A UDF only with its residency cost recorded; precomputation cannot serve `ema` of an arbitrary study. | T-0015-3 |
| 2 | Does the whole temporal walk run in SQL, or does SQL compute conditions and a Python loop walk anchors? | All in SQL. A Python walk is cause 2 in disguise — it needs every step's condition array resident. | T-0015-4 |
| 3 | Are `within` bounds validated anywhere? **They are not** — nothing rejects a negative `min` or a `max` below `min`. Pandas yields an empty window; a SQL frame will not. | Reject at setup definition in **both** engines so they do not diverge. Note it is a small behavior change. | T-0015-4 |
| 4 | Only the *anchor* is checked against the search date range, so an instance can be dated after `to_date`. Preserve or correct? | Preserve exactly, as an inherited quirk. Correcting it silently changes results for every saved setup. | T-0015-4 |
| 5 | Where does the DuckDB engine get ticker metadata for `min_market_cap` / `sectors`? It is a Python dict beside the panel today. | Register it as a queryable relation so narrowing pushes into the scan. Filtering afterwards makes a narrow universe cost the same as a wide one. | T-0015-5 |
| 6 | Does the target instance have a usable spill location? DuckDB bounds memory by spilling; the free plan has no persistent disk and the ephemeral filesystem has not been checked. | Set an explicit memory limit and a verified temp directory; treat "no usable spill location" as a deployment blocker. | T-0015-1, T-0015-8 |
| 7 | Float precision and equivalence tolerance — panel is float32, SQL will likely compute in double. | Compare instance sets exactly; explain each disagreement individually rather than widening a tolerance. Numeric statistics get a per-field justified tolerance. | T-0015-7 |
| 8 | If DuckDB fails to initialise at startup — fall back to pandas, or refuse to start? | Fall back with a loud, observable reason. Either choice must be stated, because silently serving from a different engine than selected is worse than both. | T-0015-9 |
| 9 | Sequencing against T-0013-4. | **Unresolved by design** — see below. | user |

## Relationship to T-0013-4 — recorded, not resolved

EPIC-0013's T-0013-4 (per-ticker chunked evaluation) is deferred, not
deleted, and the two workstreams overlap. **The user has not decided the
sequencing.** Both positions, as stated:

**Against doing T-0013-4 first** (`T-0013-6`): trimming the evaluator's
intermediates — float32 arithmetic, chunked condition evaluation — is
*"exactly the hand-rolled query engine `technical.md` argues against
building."* T-0013-4's own file goes further: *"do not implement this
without first rejecting DuckDB for a stated reason."* If DuckDB is happening
anyway, every hour spent on the pandas evaluator is thrown away and the SQL
port is unavoidable regardless.

**For doing T-0013-4 first** (orchestrator): per-ticker chunking is a *loop
boundary*, not a scanner. `pandas_engine.py` already calls
`panel.groupby("ticker")` on every rolling operation and in
`_search_all_tickers`; the change is to evaluate conditions inside that
existing loop instead of materializing whole-panel Series before it. It adds
no query planner, no statistics, no storage format — the three things that
make a hand-rolled scanner a liability. It is roughly a day's work against a
week-plus for the SQL port, it unblocks the POC immediately, and it is
deleted in a single commit when this epic lands.

Neither position is adopted here. What this epic does commit to: if T-0013-4
is taken first, it is a bridge with a scheduled demolition date, and
T-0015-7's differential harness gains a third engine to check rather than
changing shape.

## Out of Scope

- Any change to `backend/domain/`. The contract is the seam; if the port
  needs the contract widened, that is a finding to report, not a change to
  make.
- Removing `PandasPatternResearchEngine`. It stays as the reference
  implementation that T-0015-7 checks against, and as the mock-panel path.
  Retiring it is a later decision that needs the measurements this epic
  produces.
- Deciding the T-0013-4 sequencing (above).
- Merging, rebasing, or otherwise touching
  `epic/EPIC-0013-market-data-storage`.
- The real paid backfill and the deployed-instance measurements — those
  remain T-0013-6's outstanding ACs.
- Intraday bars, fundamentals, and any change to the ingestion pipeline.
