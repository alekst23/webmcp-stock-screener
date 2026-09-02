# T-1014-6: Backtest tools

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Done
**Depends on**: T-1014-5
**Blocks**: T-1014-11
**Issue**: —

## Description

Deliver `backtest_screener` and `get_backtest_results` — the agent-facing
half of backtesting. `backtest_screener` starts an evaluation against a
specific screener revision and returns a stable backtest ID immediately;
`get_backtest_results` reads that backtest's stored results without ever
re-executing it.

The split mirrors `run_screener` / `get_screener_results`: results are
pinned to the revision that produced them, so editing the screener
afterward cannot silently change what a backtest said.

## User Story

As a researcher validating a screen with my agent,
I want to kick off a backtest and read its results by ID afterward,
so that the numbers I am reasoning about stay attached to the exact
screener revision that produced them, however much I edit in between.

## Acceptance Criteria

1. `backtest_screener` accepts a screener revision, a historical date
   range, and forward-return horizons, and returns a stable backtest ID
   immediately without blocking on the evaluation.
2. `get_backtest_results` accepts a backtest ID and returns the stored
   results: match frequency over time, forward-return distributions per
   horizon, and drawdown statistics.
3. Results state the screener revision they were computed against, the
   universe, the date range covered, the horizons, the survivorship
   assumption, the calculation-engine version, and the market-data
   provenance envelope.
4. Editing the screener after a backtest starts does not change that
   backtest's results or the revision they report.
5. Reading a completed backtest repeatedly returns the same stored
   results; the evaluation is never re-executed implicitly.
6. Reading a backtest that has not finished returns an in-progress status
   with progress information — never partial results presented as final.
7. Reading a backtest that failed returns a failed status with the
   reason.
8. Reading an unknown or expired backtest ID is rejected saying so; no
   evaluation is started to cover for the missing result.
9. Results for a large match set are paginated and bounded, with each
   page addressed by stable IDs, and the response states the total.
10. Warnings the engine produced — lookahead handling, truncated
    coverage, insufficient history, zero matches — are surfaced to the
    caller rather than dropped.
11. `backtest_screener` accepts `expected_revision` and
    `idempotency_key` and returns the common mutation envelope; a
    repeated `idempotency_key` returns the original backtest ID rather
    than starting a second evaluation.
12. `get_backtest_results` is read-only and mutates no workspace state.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Backtest a screener"
  and "Read backtest results" scenario tables.
- `docs/reference/tool-spec.md` — `backtest_screener` and
  `get_backtest_results`; the common mutation contract; the market-data
  provenance requirement.
- `docs/plan/EPIC-1014/T-1014-5-backtest-evaluation-engine.md` — the
  engine these tools drive and the results they surface.
- `docs/plan/EPIC-1010/_epic.md` — the pinned-run and no-silent-rerun
  pattern this ticket mirrors, and its bounded-read/pagination
  conventions.
- `docs/plan/EPIC-1006/_epic.md` — mutation envelope, revisions,
  idempotency.

## Technical Considerations

- The asynchronous shape is a working assumption recorded in the epic's
  Open Questions, chosen to mirror `run_screener`. If backtests turn out
  fast enough to return inline, the ID-and-read contract should still
  hold — the pinning is the requirement, not the latency.
- An idempotency key must map to the same backtest ID, not merely to the
  same envelope, or a retry will start a second expensive evaluation.
- Results need a stated retention/expiry story so an expired ID fails
  honestly instead of silently re-running.
- Backtests are expensive. Consider rejecting or warning on a request
  whose estimated cost exceeds the configured bound, consistent with
  `validate_screener`'s expensive-query detection.

## Out of Scope

- The evaluation statistics themselves (T-1014-5).
- Visualizing backtest results in a panel.
- Comparing two backtests against each other.
- Scheduled or automatically re-running backtests.

## Solution Approach

### Architectural decision: backend HTTP boundary, browser-side WebMCP tools

`run_screener`/`get_screener_results` (EPIC-1010) never call the Python
backend -- their evaluation port is a browser-side TS engine
(`src/lib/screener/engine/engine.ts`). Backtesting cannot follow that
precedent: T-1014-5's engine (match frequency, forward-return
distributions, drawdowns, survivorship, lookahead handling) is
deliberately, explicitly Python (its own Solution Approach: "this ticket
is explicit that the backtest engine 'lives in the Python backend'").
There is no TS port for any of that math and duplicating it would defeat
the point of T-1014-5.

The precedent that *does* fit is EPIC-1012's similarity search
(`src/lib/workbench/similarity/infra/httpSimilarityApi.ts` +
`backend/api/routes/similarity.py`): a thin browser-side HTTP client over a
new FastAPI router, snake_case wire, transport failures wrapped into a
typed port error. This ticket builds the same shape for backtests:

- **Backend** (new files only): `backend/api/routes/backtest.py` +
  `backend/api/schemas/backtest.py` -- a thin HTTP boundary in front of
  T-1014-5's already-merged `PortBacktestEngine`. New infra port
  implementations (`backend/infra/panel_market_data.py`) wire the engine's
  three Protocols (`PriceSeriesPort`, `FundamentalsPort`,
  `ReferenceDataPort`, all merged by T-1014-5 with *no* infra
  implementation yet) to the same loaded OHLCV panel `PandasSimilarityEngine`
  already reads, using the same `PanelFrame` techniques (see "Market-data
  port adapters" below). A new `backend/application/backtest_jobs.py`
  in-memory job store gives `backtest_screener` its "returns immediately"
  behavior (see "Async execution" below). None of T-1014-5's own files
  (`domain/backtest_engine.py`, `domain/backtest_stats.py`,
  `domain/models/backtest.py`, `domain/contracts/*`) are modified --
  per the workflow's "do not extend already-merged sibling code" rule,
  this ticket only adds new files around them.
- **Browser**: `src/lib/workbench/backtest/` (domain/infra/tools), mirroring
  `src/lib/workbench/similarity/`'s layout: a pure translator from TS
  `ScreenerDefinition`/`FilterNode`/`Condition` (`src/lib/screener/
  definition.ts`, `conditions.ts`) to the Python wire shape
  (`domain/models/screener.py`'s snake_cased mirror), a thin fetch client,
  and the two WebMCP tools. Registered via
  `registerBacktestTools.ts`/`BACKTEST_TOOLS_ENABLED = false`, matching
  every sibling tool group in this program (`SCREENER_TOOLS_ENABLED`,
  `SIMILARITY_TOOLS_ENABLED`, `WATCHLIST_TOOLS_ENABLED`,
  `ALERT_TOOLS_ENABLED`, `CHART_TOOLS_ENABLED`, `WORKBENCH_TOOLS_ENABLED`
  are all `false` too -- flipping every surface on together is a later,
  whole-program decision no single ticket makes).

### Market-data port adapters (new, bounded)

T-1014-5 built the three market-data Protocols against fixtures only ("do
not build a mock pipeline" was *its* constraint for unit testing the
engine in isolation). Something has to implement them for the HTTP
boundary to run anything for real, and this ticket is the one building
that boundary, so it owns this:

- `PanelPriceSeriesPort` -- real, over the already-loaded `PanelFrame`
  (the same panel `PandasSimilarityEngine`/`PandasPatternResearchEngine`
  read). `get_bars` and `get_series` (limited to the four raw OHLC fields;
  an unrecognized `catalog_id` returns `[]`, which the engine's own
  `filter_evaluation.py` already treats as "not evaluable," never a
  fabricated value) reuse `PanelFrame.bounds`/`date_at`/`bar_at` exactly as
  `infra/similarity_engine.py` does. `provenance()` mirrors
  `PandasSimilarityEngine._provenance()` off the same `PanelStatus`.
- `NoFundamentalsPort` -- honest "no coverage" default: `field_ids()`
  returns `frozenset()`, `supports_point_in_time()` returns `False`,
  `get_reported_value` returns `None` always. This repo has no
  point-in-time fundamentals source in Python (T-1014-5's own note: no
  Python reference/fundamentals port existed before it). Fabricating one
  here would violate this program's "explicit unavailable, never
  placeholder" convention (`domain/panel_disclosure.py`,
  `unavailableMarketData.ts`); the engine already handles an all-empty
  `field_ids()` correctly (every field classifies as PRICE, no
  fundamentals lookahead warning fires because none can).
- `PanelReferenceDataPort` -- `includes_delisted/merged/renamed` all
  `False` (the panel carries no corporate-action history, so the engine's
  own survivorship-statement branch for "does not include" fires
  honestly); `get_universe_members` resolves `UniverseSpec.tickers` when
  given, else every ticker in the panel, filtered by `min_price`/
  `min_avg_volume` (trailing 20-session average as of the rebalance date)
  /`min_market_cap` (from `LoadedPanel.universe`'s `TickerMetadata`, the
  same Nasdaq-screener sourced sector/cap data
  `PandasPatternResearchEngine._filter_universe` already reads) and
  `excluded_tickers`; `get_delisting_events`/`get_event_occurrences`
  return `[]` (no calendar/corporate-action data exists in Python).

These are new files implementing already-merged Protocols, not edits to
the Protocols or the engine -- the same relationship
`infra/similarity_engine.py` has to `domain/contracts/similarity_engine.py`.

### Async execution (AC1, AC6)

`PortBacktestEngine.run()` is a synchronous, potentially multi-second call
(bounded by T-1014-5's own `MAX_RANGE_SESSIONS`/`MAX_UNIVERSE_SIZE`, but
still real CPU work). `POST /api/backtests` must return before that work
finishes (AC1) and a concurrent `GET` must be able to observe "running"
(AC6) -- which rules out Starlette's `BackgroundTasks` (its callback runs
as part of the same request/response ASGI cycle; under `TestClient` it
completes *before* the client call returns, making "in progress" untestable
and, in a single-worker dev server, blocking the event loop other requests
share). Instead: `backend/application/backtest_jobs.py`'s
`BacktestJobStore.create()` mints a `backtest_id`, stores a `running` job,
and the route explicitly does `asyncio.create_task(...)` (reference kept on
the job so it is never GC'd mid-flight) wrapping
`loop.run_in_executor(None, engine.run, request)` -- offloaded to a thread
so the event loop stays free to serve `GET` polls while the engine runs.
Any exception from `engine.run` (including T-1014-5's
`InsufficientHistoryError`) resolves the job to `failed` with the message
as the reason (AC7) -- a uniform path, no special-cased pre-validation at
POST time, keeping "returns immediately without blocking on the
evaluation" true without an exception for the insufficient-history case.

### Retention/expiry (AC8) and pagination (AC9)

`BacktestJobStore` bounds itself to `MAX_STORED_BACKTESTS` (50) completed/
failed jobs (a `running` job is never evicted); the oldest is evicted
first. Evicted ids are remembered (bounded set) so a later `get()`
distinguishes `reason: 'evicted'` from `reason: 'unknown'` -- mirroring
`src/lib/screener/ports.ts`'s `RunNotAvailable` shape exactly, the same
"never a silent rerun" structural guarantee: nothing reachable from
`BacktestJobStore.get()` can start a new evaluation. `GET
/api/backtests/{id}` paginates `match_frequency` (the field that can grow
large over a long daily-rebalance range) via `offset`/`limit`, mirroring
`api/routes/similarity.py`'s `get_run` -- `total`/`offset`/`next_offset`
in the response, and each point given a stable `id` (`mf_<on_date
ISO>_<index>`, derived, not a fresh mint, so the same page re-read returns
the same ids). Every other result field (`forward_returns`, `drawdown`,
`survivorship`, `provenance`, `warnings`) is small and returned in full
every read, matching `SimilarityRunPage`'s "paginate only the field that
can be large" precedent.

### Mutation envelope (AC11) and idempotency

`backtest_screener` does not mutate the workspace document -- like
`run_screener`, there is no new field on `WorkspaceDocument` to write.
AC11 still requires the common envelope, so it is returned literally
(`newRevision` echoes the current, unchanged workspace revision;
`affectedIds` is `[screener_id]`; `undoToken` is `null` -- nothing to
undo), alongside `backtest_id` and `status`, matching
`upsertWatchlist.ts`'s "envelope plus the domain payload" response shape.
`expected_revision` is an optimistic-concurrency guard against the
workspace document only (same `RevisionConflictError` `run_screener`
raises) -- it does not gate anything backend-side. `idempotency_key`
replay is handled entirely browser-side, via a private replay cache
identical in shape to `runScreener.ts`'s `createRunReplayCache` (fingerprint
on workspaceId/screenerId/screenerRevision/expectedRevision/from_date/
to_date/horizons/rebalance): a repeated key returns the cached envelope
(and therefore the same `backtest_id`) without a second HTTP POST, so the
backend needs no idempotency handling of its own -- it never sees a
retried request. `screener_revision` resolution reuses `run_screener`'s
own logic and error (`resolveScreenerRevision`, ported into this tool
rather than imported, since `runScreener.ts` does not export it and
duplicating ~25 lines is cheaper than widening that module's surface for
one caller).

### Translation from TS to the Python wire shape

`src/lib/workbench/backtest/domain/translateScreener.ts`: pure functions
mapping `FilterNode`/`Condition` (camelCase) to the snake_cased dict shape
`domain/models/screener.py` expects field-for-field (`fieldId` ->
`field_id`, `withinBars` -> `within_bars`, etc.) -- exhaustive over all
eight condition variants and both node kinds, matching T-1014-5's own
mirror relationship. TS's `UniverseSpec` (assetClass/exchanges/countries/
sectors/industries/indexes/watchlists/liquidity/exclusions) is strictly
richer than Python's deliberately-smaller `UniverseSpec` (no sector/
exchange/index classification exists in Python); `translateUniverse`
maps `liquidity.*` -> `min_price`/`min_avg_volume`/`min_market_cap` and
`exclusions.instrumentIds` -> `excluded_tickers`, and returns a
`droppedCriteria: string[]` alongside the translated universe whenever
`exchanges`/`countries`/`sectors`/`industries`/`indexes`/`watchlists` is
non-empty -- these are surfaced as warnings on the started backtest's
envelope (AC10 in spirit: nothing silently vanishes) rather than silently
ignored or used to reject the request outright (a screener that also
scopes by sector is still worth backtesting on its price/fundamental
conditions; the universe is just coarser than requested, and the warning
says so).

### Test plan

- `backend/tests/unit/test_panel_market_data.py` -- `PanelPriceSeriesPort`
  against a small synthetic panel (get_bars/get_series/provenance,
  unrecognized catalog_id returns `[]`); `NoFundamentalsPort` (all-empty
  contract); `PanelReferenceDataPort` (ticker/price/volume/market-cap
  filtering, exclusions, point-in-time "as of" bar lookup, no
  delisting/event data).
- `backend/tests/unit/test_backtest_jobs.py` -- create/complete/fail/get,
  eviction beyond `MAX_STORED_BACKTESTS` (running jobs never evicted),
  unknown vs. evicted `reason`.
- `backend/tests/unit/test_backtest_routes.py` -- a standalone `FastAPI()`
  + this router only (never imports `main.app`, which pulls in the
  pre-existing missing-`limits` collection failure): POST returns before
  a controllable fake engine (blocking on a `threading.Event`) finishes,
  so a concurrent GET observes `running` deterministically before the
  event is released and a subsequent GET observes `completed`; a fake
  engine that raises `InsufficientHistoryError` resolves to `failed` with
  the message; unknown and evicted ids are rejected without starting
  anything; `match_frequency` pagination totals/offsets.
- `src/lib/workbench/backtest/domain/translateScreener.test.ts` -- one
  case per condition variant round-tripping to the documented snake_case
  shape; `droppedCriteria` fires for each non-representable universe
  field and stays empty otherwise.
- `src/lib/workbench/backtest/infra/httpBacktestApi.test.ts` -- wire
  parsing/error-mapping against a fake `fetch`, mirroring
  `httpSimilarityApi`'s own test shape.
- `src/lib/workbench/backtest/tools/backtestScreener.test.ts` -- AC4
  (screener edited after start still reports the pinned revision, proven
  against a fake port that would return different data for the current
  vs. pinned revision), AC11's idempotency-maps-to-same-backtest-id (two
  calls with the same key against a counting fake HTTP port assert
  exactly one POST and the same `backtest_id` in both results), revision
  conflict, translation-warning surfacing.
- `src/lib/workbench/backtest/tools/getBacktestResults.test.ts` -- AC5/AC8
  as a structural property of this tool: a counting fake `BacktestApiPort`
  proves `get_backtest_results` never calls `start()`, only `getResults()`,
  across any number of reads -- it has no code path capable of triggering
  re-execution, mirroring `PinnedRunStore`'s own "no method exists that
  reruns" guarantee. Also: running/failed/completed status passthrough,
  an unknown/evicted id rejected without starting anything, pagination
  passthrough.

Each new test is checked to fail when its corresponding logic is reverted
(mutation-check), per the workflow's requirement -- most directly for the
no-silent-rerun and idempotency-maps-to-same-id guarantees named in the
final report.

### Out of scope carried forward from the ticket

Everything the ticket's own Out of Scope section already excludes, plus:
sector/exchange/index-aware universe resolution in Python (no such data
exists there); a richer catalog of price-derived studies in
`PanelPriceSeriesPort.get_series` beyond raw OHLC (T-1014-5's own
`pattern`/`study_output`/non-`own_moving_average` `relative` carve-out
already covers this at the engine level); persistence of backtest jobs
across a backend process restart (in-memory only, matching this
program's existing `PinnedRunStore`/`SimilarityEngine` run stores).
