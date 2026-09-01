# DuckDB Query Engine — Technical Design

> Product spec not yet written. Run `/at-epic-design EPIC-0015` to produce
> `spec.md`. This document records the technical decisions and the open
> questions that were found rather than invented, so the epic's tickets have
> something to argue with.

## Why this exists

`docs/design/market-data-storage/technical.md` names a three-rung upgrade
ladder and designates DuckDB over R2 Parquet as rung 2, to be taken *"when
resident memory at the target universe exceeds the instance budget's
headroom."* That rung was described in prose and never given a ticket, a
contract, or an estimate. Nothing anywhere addressed how multi-step temporal
matching becomes SQL, which is the hard part.

EPIC-0015 makes rung 2 real. This document records what measurement changed
about the plan.

## The trigger fired for a different reason than it was written

The written trigger is about **residency**. Residency is fine.

Measured this session on a synthetic 2,000-ticker x 5-year panel (2.52M
rows), as absolute process RSS — the quantity Render's OOM killer acts on:

| moment | absolute RSS |
|---|---|
| bare interpreter | 14 MB |
| + numpy / pandas / pyarrow | 90 MB |
| + application imports | 100 MB |
| + whole Parquet file as a Python `bytes` | 217 MB |
| + parsed to the compact panel | 364 MB |
| **the panel itself** | **65.7 MB** |
| before search | 385 MB |
| **peak during search** | **723.5 MB** |

The panel is 65.7 MB against a 512 MB budget. `market-data-storage`'s
residency claim holds precisely, as T-1016-6 already recorded. What overruns
the budget is *evaluation transients*, and the written trigger would never
have fired on them.

Worse, those transients are not a function of the data. The same panel,
searched two ways:

| pattern | search growth |
|---|---|
| 2 steps, 0 studies | 211 MB |
| 3 steps, 4 composed studies | **348 MB (+65%)** |

Identical rows. The cost is set by **how the question is written**. That is
why trimming the universe — T-1016-6's option 1 — is a fix with a short
half-life: it buys headroom against row count while leaving the actual
gradient untouched, and the next expressive pattern spends it.

**The design doc's trigger wording is wrong and EPIC-0015 supersedes it.**
The condition it was a proxy for — the instance budget being exceeded at the
target universe — did occur. The proxy did not.

## The four causes, all in the evaluator

Read on `main`, line numbers verified:

1. **`backend/infra/expression.py:197`** — `_resolve_name` calls
   `self.evaluate(...)` for a study reference, which re-parses the study's
   expression and re-evaluates it from scratch. There is no memoization. A
   study referenced twice costs twice; a study defined in terms of two other
   studies multiplies.
2. **`backend/infra/pandas_engine.py:123`** — `conditions = [ ... for step
   in setup.steps]` materializes every step's whole-panel boolean Series and
   holds them all at once for the duration of the walk.
3. **`backend/infra/expression.py:210`** — `_eval_boolop` builds the full
   list of operand Series before combining any of them. An `and` of four
   terms holds four whole-panel Series simultaneously, when it could fold
   them pairwise and release each.
4. **The rolling helpers** — `sma`, `ema`, `highest`, `lowest`, `atr`, and
   `days_since` all route through `groupby(...).transform(lambda ...)`,
   which materializes a result per ticker group and concatenates them. On a
   2,000-ticker panel that is 2,000 intermediate objects per call.

Causes 1, 3, and 4 are structural properties of evaluating a tree into eager
whole-panel arrays. Cause 2 is the matcher doing the same thing at a higher
level. A query planner does not have any of them: it fuses the pipeline,
bounds its own memory, and spills when it must.

## Decisions

### The domain contract is the seam and does not move

`backend/domain/contracts/engine.py` defines `PatternResearchEngine` as a
Protocol with seven methods — `define_study`, `define_setup`,
`find_instances`, `sample_instances`, `measure`, `split_instances`,
`get_instance_windows`. Verified unchanged on `main`.

The DuckDB engine is a second structural implementation of that Protocol.
Nothing in `backend/domain/` changes. This is what makes the port a wiring
decision at the composition root rather than a rewrite, and it is what lets
both engines exist simultaneously — which the differential harness requires.

If the port appears to need the contract widened, that is a finding to
report before writing code. A contract that bends to accommodate its second
implementation was never a seam.

### The `ast` whitelist stays, and stays the safety boundary

`expression.py`'s module docstring is explicit: parsing goes through
Python's `ast` restricted to a node-type whitelist *"so evaluation never
runs arbitrary code — this is a safety boundary, not a language
limitation."*

Generating SQL does not weaken this and must not become a way around it. The
rule: **SQL fragments are emitted only from AST nodes that already passed
validation, through a fixed node-type-to-fragment mapping. No user-supplied
text is ever concatenated into a statement.**

Two consequences worth stating, because they are where injection would
actually enter:

- **Field and study names** are validated against a closed set before
  anything is emitted — the five base fields plus the session's defined
  study names. An identifier that is not in that set never reaches SQL; it
  raises the existing domain error instead. Study names are not free text
  reaching a statement: they map to generated internal subquery names.
- **Window sizes** are already required to be integer literals at parse time
  (`_WINDOW_ARG_INDEX` / `_is_int_literal`). That existing check is what
  makes them safe to place directly into a window frame specification, which
  is the one place most databases will not accept a bound parameter. Every
  other value that varies — dates, thresholds, ticker lists — is a bound
  parameter.

### `ema` is not a window function

Five of the six catalog functions map to window aggregates over `PARTITION
BY ticker ORDER BY date` with an explicit `ROWS BETWEEN` frame, preserving
the documented semantics: `highest`/`lowest` look **strictly before** the
current bar (`ROWS BETWEEN n PRECEDING AND 1 PRECEDING`), `sma` and `atr`
include it.

`ema` is `ewm(span=n, adjust=False)`, the linear recurrence
`y_t = a*x_t + (1-a)*y_(t-1)` with `a = 2/(n+1)`. Each output depends on the
previous *output*, so no bounded frame computes it. T-0015-3 owns the
mechanism choice.

**Rejected once, with a reason: the closed-form expansion.** `y_t` expands
to a weighted sum of all prior `x_k` with weights `a*(1-a)^(t-k)`, which
looks like a running sum and is not one — computing it that way requires
accumulating `x_k / (1-a)^k`, and `(1-a)^k` underflows to zero within a few
hundred bars for any usable span, so the accumulator diverges long before ten
years of history. Recorded so it is not rediscovered.

### Multi-step matching: precomputed next-resolution, not a temporal join

`SetupStep.within = (min, max)` means step N fires between `min` and `max`
**trading bars** after step N-1 *resolved*. Offsets compound down the chain.
This is the port's single most uncertain piece.

The naive formulation — one range self-join per step — enumerates every
satisfying combination and then discards all but the earliest, which is the
opposite of what the memory budget allows.

The tractable formulation computes, for every bar and every step, where that
step would next resolve, as a window aggregate:

- **non-sustained step `i`**: the minimum bar ordinal at which condition `i`
  holds, over `ROWS BETWEEN min FOLLOWING AND max FOLLOWING` partitioned by
  ticker. Null means "did not fire in the window".
- **sustained step `i`**: a "held throughout" boolean over the same frame,
  resolving at `previous + max`.

One pass over the panel per step. The walk then reduces to `k-1` equality
lookups from a candidate's current ordinal to the precomputed next-resolution
ordinal — hash joins over the anchor set, not over the panel.

The trap: a window frame silently truncates at the partition's end, so a
null result means *either* "did not fire" *or* "the window ran off the end
of loaded history". Only comparing `previous + max` against the ticker's
last ordinal separates a decisive failure from a trailing-edge partial.
Getting this wrong turns every trailing-edge candidate into a silent
failure, invisible until partial counts are compared — which is exactly what
T-0015-7 compares.

### Replacing a working component requires differential evidence

`PandasPatternResearchEngine` works and is well tested. Its own tests are
not evidence that a replacement is correct — they check what their author
thought to check.

T-0015-7 runs both engines over the same panel across a corpus and compares
field by field. It is the safety net that makes the port defensible, and it
is the reason the pandas engine is explicitly **not** deleted by this epic.

One rule about it, stated in advance because it is the failure mode:
floating-point boundary disagreements — a comparison flipping because two
arithmetically-equivalent expressions rounded differently — must be reported
and explained individually, never absorbed by widening a tolerance until the
suite goes green. A tolerance wide enough to hide a rounding flip is wide
enough to hide a wrong window bound.

### Memory must be measured absolutely

EPIC-1016's `backend/scripts/measure_universe_scale.py` captures a baseline
after the panel is built and subtracts it from every reading. Its figures are
therefore *growth*, not footprint, and understate what Render sees by roughly
the 90-100 MB of interpreter and library residency measured above.

EPIC-0015 measures **absolute peak RSS for the whole process** at every
lifecycle stage, and varies **expression complexity** as well as row count —
because complexity is the variable that produced the +65% and a row-scaling
measurement would miss a regression of the same kind entirely.

## Reading Parquet from R2

DuckDB's `httpfs` against the existing R2 credentials —
`R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_NAME`, read by `backend/infra/object_store.py` from the gitignored
root `.env`, and dashboard secrets (`sync: false`) on Render. R2 speaks the
S3 API with region `auto` for the SigV4-scope reason `object_store.py`
documents.

`config_from_env` returning `None` when the set is incomplete is a supported
state, not a misconfiguration, and must stay that way: a local checkout and
every test run legitimately have no credentials and fall back to the mock
panel.

**Pushdown against T-1016-3's layout.** The panel is written sorted by
ticker in 25,000-row row groups (~10 tickers' full history each), and
T-1016-3 measured what that buys: 1 ticker reads 0.9% of the file, 100
adjacent tickers 4.3%, half the universe 51.3%, and `close` alone 24.4%.
Its own caveat is the one that matters here — **pruning is a function of
ticker *adjacency*, not ticker count.** A hundred tickers scattered across
the alphabet touch 100 of 120 row groups and read 83%. Column projection
pays unconditionally; ticker pruning pays only for narrow or contiguous
selections. Scattered reads are exactly the access pattern
`get_instance_windows` and the base-rate sample generate, which is why
T-0015-6 measures them separately rather than inheriting T-1016-3's table.

**Caching versus re-fetch** is deliberately a ticket-level decision
(T-0015-1) with an explicit requirement to *record* the behavior rather than
inherit whatever the defaults are. An interactive research session issues
many queries against the same panel; re-fetching per query trades the memory
win for a latency loss, and caching the whole file locally trades it back for
the residency this epic exists to remove.

## Dependency on unmerged work

**T-1016-3 (ticker-partitioned Parquet) is implemented but unmerged**, on
`epic/EPIC-1016-market-data-storage`. This epic reads the layout it produces.
Until that branch lands on `main`, EPIC-0015's pushdown measurements have no
real layout to measure against.

EPIC-0015 does not modify, merge, or rebase that branch.

## Open questions

Recorded rather than guessed. Each carries a recommended default so a ticket
can proceed without waiting, and so a different choice has to be argued for.

1. **How is `ema`'s recurrence evaluated?** Recursive CTE, a Python UDF on
   the connection, or precomputation at ingest. *Recommended default:*
   recursive CTE, measured; fall back to a UDF only with its residency cost
   recorded, because a UDF puts Python back on the hot path and partially
   defeats the epic's purpose. Precomputation cannot serve `ema` of an
   arbitrary study and is at best a partial answer. Owned by T-0015-3.

2. **Does the whole temporal walk run in SQL, or does SQL compute the
   conditions and a small Python loop walk the anchors?** *Recommended
   default:* all of it in SQL, via the precomputed next-resolution formulation
   above — the Python walk is cause 2 in disguise, since it needs every step's
   condition array resident. Fallback if that measures badly: keep the walk in
   Python but stream anchors per ticker rather than materializing panel-wide,
   and record the residency cost. Owned by T-0015-4.

3. **Are `within` bounds validated anywhere?** They are not.
   `SetupStep.within` is a plain `tuple[int, int]`; nothing rejects a negative
   `min` or a `max` below `min`. Pandas slicing tolerates both by yielding an
   empty window; a SQL window frame will not. *Recommended default:* reject
   them at setup definition with the existing domain error, in **both**
   engines, so the two do not diverge on malformed input — and note that this
   is a behavior change, however small, from silently-no-match to an error.

4. **Only the anchor is checked against the search date range.**
   `_search_all_tickers` tests `search_from <= dates[anchor] <= search_to` and
   nothing else, so an instance whose later steps resolve after `to_date` is
   still returned and dated outside the requested range. *Recommended
   default:* preserve it exactly and note it as an inherited quirk. Changing
   it would silently alter results for every existing saved setup, and this
   epic's job is to be indistinguishable.

5. **Where does the DuckDB engine get ticker metadata for `min_market_cap`
   and `sectors`?** It lives in a Python dict beside the panel today, built
   from `universe.csv`. *Recommended default:* register it as a queryable
   relation so the narrowing pushes into the scan — filtering results in
   Python afterwards would make a narrow universe cost the same as a wide
   one, defeating the point.

6. **Does the target instance have a usable spill location?** DuckDB bounds
   its memory by spilling, which needs writable disk with room. Render's free
   plan has no persistent disk (`render.yaml` records this) and the ephemeral
   filesystem's capacity has not been checked. *Recommended default:* set an
   explicit memory limit and a verified temp directory in T-0015-1, and
   treat "no usable spill location" as a deployment blocker surfaced by
   T-0015-8 rather than discovered in production.

7. **Float precision and equivalence tolerance.** The panel is stored
   float32; SQL arithmetic will likely run in double precision. *Recommended
   default:* compare instance sets (ticker, date, completeness, counts)
   exactly and treat any disagreement as a defect to explain individually —
   not a tolerance to widen. Numeric statistics get a per-field tolerance
   justified by the arithmetic.

8. **What happens if DuckDB initialisation fails at startup — fall back to
   pandas, or refuse to start?** *Recommended default:* fall back with a
   loud, observable reason, consistent with the codebase's existing
   serve-and-disclose posture. Whichever is chosen must be a stated decision
   (T-0015-9 AC8), because silently serving from a different engine than the
   operator selected is worse than either.

9. **Sequencing against T-1016-4.** Unresolved by design — see below.

## Relationship to T-1016-4 — recorded, not resolved

EPIC-1016's T-1016-4 (per-ticker chunked evaluation) is deferred, not
deleted. Its file says: *"do not implement this without first rejecting
DuckDB for a stated reason."* **The user has not decided the sequencing, and
this epic does not decide it either.** Both positions, as stated:

**Against T-1016-4 first** (`T-1016-6`): trimming the evaluator's
intermediates — float32 arithmetic, chunked condition evaluation — is
*"exactly the hand-rolled query engine `technical.md` argues against
building."* If DuckDB is happening anyway, every hour spent on the pandas
evaluator is thrown away, and the SQL port is unavoidable either way.

**For T-1016-4 first** (orchestrator): per-ticker chunking is a *loop
boundary*, not a scanner. `pandas_engine.py` already calls
`panel.groupby("ticker")` on every rolling operation and in
`_search_all_tickers`; the change is evaluating conditions inside that
existing loop instead of materializing whole-panel Series before it. It adds
no query planner, no statistics, no storage format — the three things that
make a hand-rolled scanner a liability. Roughly a day's work against a
week-plus for the SQL port, it unblocks the POC immediately, and it is
deleted in a single commit when EPIC-0015 lands.

What this design does commit to: if T-1016-4 is taken first, it is a bridge
with a scheduled demolition date, and it becomes a third implementation in
T-0015-7's differential harness — which is why that harness must not assume
exactly two engines.

## What would falsify this epic's premise

Stated in advance so a bad result is recognised rather than rationalised:

- If T-0015-8 finds peak RSS still growing materially with expression
  complexity, the diagnosis was wrong and the epic bought nothing.
- If bounding memory requires spilling that the target instance cannot
  provide, or costs latency that makes interactive research unusable, then
  rung 2 does not fit this deployment and the honest answer is rung 3 or a
  smaller universe.
- If `httpfs` re-fetches the panel per query over the network, the memory
  win is paid for in latency and the caching question (T-0015-1) becomes the
  epic's real risk rather than a detail.
