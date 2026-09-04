# T-0025-2: `POST /screener/run` endpoint

**Epic**: EPIC-0025 (Server-Side Screener Evaluation Endpoint)
**Design**: docs/design/screener-core/
**Status**: Not started
**Depends on**: T-0025-1
**Blocks**: —
**Resolves**: #25

## Description

Wires T-0025-1's resolvers and the existing filter-tree evaluator
(`backend/domain/filter_evaluation.py`) into one stateless endpoint: a
screener definition in, a bounded ranked result set out. `dry_run: true`
validates the same definition through the same pipeline without
executing it, so validation and execution can never disagree about what
passes.

This is the contract EPIC-0026's `HttpScreenerEvaluationPort` targets —
`{universe, conditions, ranking, limit}` in, and a response shaped to
become a frontend `ScreenerRun` without transformation.

## User Story

As the frontend `ScreenerEvaluationPort`,
I want one endpoint that validates or executes a screener definition
against real data,
so that `run_screener` and `validate` (via `define_screener`) get a real
answer instead of an empty-universe refusal.

## Acceptance Criteria

1. `POST /screener/run` with `{universe, conditions, ranking, limit}`
   narrows the universe (T-0025-1), resolves every field the conditions
   and ranking reference, evaluates the filter tree, ranks, and truncates
   to `limit`.
2. `dry_run: true` runs the same universe-narrowing and field-resolution
   steps and reports every independent validation problem together
   (invalid parameters, unresolvable fields, contradictory filters, a
   universe that resolves to zero instruments) without executing.
3. A universe that resolves to zero instruments is a refusal naming the
   reason, never an empty success.
4. The response carries, per matched instrument: a full instrument
   reference (id, symbol, exchange, asset type — not a bare ticker),
   every ranking field's value, and per-filter-node pass/fail state.
5. The response carries run-level provenance: `as_of`, live/delayed
   status, universe/matched/returned counts, and whether results were
   truncated by `limit`.
6. The endpoint is stateless — it does not persist the run; the caller
   (browser) owns pinning and retention.
7. Every problem `dry_run` or a real evaluation reports is independently
   reproducible from the request (no reliance on prior calls) — the
   endpoint has no session state to get out of sync.

## Out of Scope

- Server-side run storage or a `GET` by run id — the browser pins runs
  in-memory (`PinnedRunStore`), unchanged by this ticket.
- Anything on the frontend — EPIC-0026 wires the caller.
- Full catalog-backed parameter-range and cross-condition contradiction
  validation — both need the catalog registry `docs/design/screener-core/spec.md`'s
  Preconditions name as EPIC-1008, which is TS-only and was never ported to
  Python (confirmed: no Python catalog registry exists anywhere in
  `backend/`). Building one is a separate epic's work, not fabricable here.
  This ticket implements the two validation problems that don't need a
  catalog: an empty-resolving universe (AC3) and unresolvable-field
  detection via the evaluator's own existing `find_unevaluable_conditions`
  static scan. Documented explicitly (per this repo's "explicit
  unavailable, never a placeholder" convention) rather than silently
  passing every screener as parameter-valid.

## Implementation Plan

Design/test gates skipped for this ticket (`--skip-design-gate`), same
convention as T-0025-1. Depends on T-0025-1 landing first (universe
sectors field, `SectorCatalog`, `field.price.change_pct`).

1. **`domain/models/screener_run.py`** (new file) — fresh Pydantic models,
   no committed TS/HTTP contract exists yet to match (confirmed:
   `HttpScreenerEvaluationPort` doesn't exist; EPIC-0026 builds it against
   whatever this ticket ships). Field names chosen to match
   `docs/design/screener-core/technical.md`'s `ScreenerRun` table and the
   frontend's `toWireScreenerRun` snake_case expectations where an
   equivalent already exists in TS, so a future `HttpScreenerEvaluationPort`
   can map through with minimal translation:
   - `RankingField {field_id, direction: 'asc'|'desc', weight}`,
     `RankingSpec {fields, tie_break: RankingField | None, normalization}`.
   - `ValidationProblem {severity: 'blocking'|'advisory', code, node_ids,
     universe_criteria, message}` — `code="empty_universe"` reuses the
     frontend's existing `PROBLEM_CODES.emptyUniverse` string exactly, so
     EPIC-0026 doesn't have to remap it. Unrecognized sector values use
     `code="unrecognized_value"` (no exact existing frontend code fits —
     `unknown_catalog_item` is about catalog items, not universe values —
     flagged here for EPIC-0026 to confirm/rename if the frontend wants a
     different string).
   - `FilterNodeEvaluation {node_id, passed, value, unit, detail,
     data_unavailable}`.
   - `ScreenerMatch {instrument: InstrumentRef, rank, composite_score,
     ranking_values, node_evaluations}` — reuses
     `domain.models.similarity.InstrumentRef` (already has exactly AC4's
     "id, symbol, exchange, asset type" shape) rather than inventing a
     second instrument-reference type. Built the same honest way
     `infra/similarity_engine.py` already does —
     `InstrumentRef(instrument_id=ticker, symbol=ticker)`, exchange/asset_type
     left `None` — no per-ticker exchange/asset-type source exists in this
     repo's Python side (same gap `TickerMetadata` already has).
   - `ScreenerRunRequest {universe: UniverseSpec, filter_tree: FilterNode,
     ranking: RankingSpec | None, limit}` — no `dry_run` needed as a normal
     field mismatch since it *is* one; no caller-supplied `as_of` (stateless
     scope, always the loaded panel's own `as_of`, matching AC6/AC7 — no
     session state to get out of sync with).
   - `ScreenerRunResult {status: 'complete'|'refused'|'valid', as_of,
     universe_count, matched_count, returned_count, truncated,
     ranking_applied, matches, problems, provenance}` — **one flat shape,
     `status` discriminates**, mirroring `api/schemas/backtest.py`'s
     `BacktestResultsResponse` convention exactly rather than a tagged
     Pydantic Union (this codebase's established pattern for "one endpoint,
     several outcomes"). `'refused'` = a blocking problem (AC3's empty
     universe, or any future blocking check); `'valid'` = `dry_run=true`
     with no blocking problems (AC2's validation report); `'complete'` = a
     real, executed run.

2. **`domain/contracts/screener_run_engine.py`** (new file, mirrors
   `domain/contracts/backtest_engine.py`) — `ScreenerRunEngine` Protocol,
   `run(request: ScreenerRunRequest) -> ScreenerRunResult`.

3. **`domain/screener_run_engine.py`** (new file, mirrors
   `domain/backtest_engine.py`'s `PortBacktestEngine` wiring pattern
   exactly — `_build_resolver`/`_value_at` copied almost verbatim, single
   `as_of` instead of a rebalance walk) — `PortScreenerRunEngine`:
   - Constructor: `price_port: PriceSeriesPort`, `reference_port:
     ReferenceDataPort`, `sector_catalog: SectorCatalog` — three Protocols,
     zero infra imports (the inviolable domain/infra rule).
   - `as_of = price_port.provenance().as_of.date()`.
   - `universe_count`/`members = reference_port.get_universe_members(as_of,
     request.universe)` — exclusions already applied internally, no
     redundant subtraction (unlike `backtest_engine.py`'s belt-and-suspenders
     one, not needed here since there's no schedule loop reusing `members`
     across dates).
   - Blocking-problem pass: empty universe (AC3) -> `ValidationProblem`
     naming the criterion; unrecognized sectors via
     `sector_catalog.unrecognized_sectors(request.universe.sectors or [])`.
   - Advisory pass: `find_unevaluable_conditions(request.filter_tree)` (T-1014-5's
     existing static scan, already imported by `backtest_engine.py` the same
     way) -> one advisory `ValidationProblem` per affected node, same
     fails-closed semantics as the backtest engine (never a blocking
     refusal — the condition still evaluates, just always to `False`).
   - If any blocking problem: return `status="refused"`, `problems=`
     blocking + advisory, `universe_count` as computed, no execution.
   - Else if `request.dry_run`: return `status="valid"`,
     `problems=advisory`, no execution (AC2, AC7).
   - Else: execute — `evaluate_node` per member (reused verbatim from
     `filter_evaluation.py`, zero changes there), build
     `node_evaluations` per match via a small recursive walk over
     `filter_tree` calling `evaluate_condition` per leaf (groups get
     `passed` only, `value=None` — a group has no single value to report),
     resolve ranking field values, rank (see below), truncate to `limit`,
     return `status="complete"`.
   - Ranking: percentile-rank normalization within the matched set before
     weighting (`spec.md`'s Open Question 3 documented assumption) — for
     each ranking field, rank matched tickers by that field's resolved
     value (missing value -> excluded from that field's ranking, that
     match's `ranking_values[field_id] = None`, contributes 0), average
     rank rescaled to [0,1], weighted sum = `composite_score`. No
     `ranking` on the request -> `ranking_applied=False`, deterministic
     default order (ticker ascending, `spec.md`'s documented default).
   - Provenance: `price_port.provenance().model_copy(update={"engine_version":
     SCREENER_ENGINE_VERSION})`, same pattern `backtest_engine.py._provenance`
     uses.

4. **`infra/panel_market_data.py`**: `PanelReferenceDataPort` already
   satisfies `SectorCatalog` once T-0025-1 lands (`unrecognized_sectors`
   defined there) — no further infra change needed here.

5. **`api/schemas/screener.py`** (new, thin, mirrors `api/schemas/backtest.py`'s
   `BacktestStartRequest = BacktestRequest` re-export convention) —
   `ScreenerRunRequestWire = ScreenerRunRequest`,
   `ScreenerRunResponseWire = ScreenerRunResult`. No reshaping needed; the
   domain model IS the wire shape, same relationship `BacktestResultPage`
   has to `BacktestResult`.

6. **`api/routes/screener.py`** (new, mirrors `api/routes/chart.py`'s thin
   dependency-injection convention, not `backtest.py`'s async-job one — this
   endpoint is synchronous request/response per the epic's explicit
   "stateless... in, out" framing):
   `router = APIRouter(prefix="/api/screener", tags=["screener"])`,
   `POST /run` — `Depends(get_screener_engine)` reading
   `request.app.state.screener_engine`, 503 with a `_NO_ENGINE` message
   (same convention as `backtest.py`/`chart.py`) when no panel is loaded.
   Route body is a one-line delegation to `engine.run(payload)` — all
   orchestration stays in the domain engine (Rule: api/ is HTTP concerns
   only).

7. **`main.py`**: extend `_load_engine()`'s return tuple to also build and
   return a `PortScreenerRunEngine` (reusing the same `price_series_port`
   and a `PanelReferenceDataPort` instance — the same one already built for
   `backtest_engine`, now also passed as the `sector_catalog` argument
   since it structurally satisfies both Protocols). Store on
   `app.state.screener_engine` in `_lifespan`. Add
   `from api.routes.screener import router as screener_router` +
   `app.include_router(screener_router)`.

8. **Tests**:
   - `tests/unit/test_screener_run_engine.py` (new, mirrors
     `test_backtest_engine.py`'s fake-port style) — one test per AC:
     happy path narrows+evaluates+ranks+truncates; `dry_run` reports
     problems without executing; empty universe is `status="refused"`
     never an empty `"complete"`; zero *matches* (universe non-empty, no
     ticker passes the filter tree) is a normal `"complete"` run with
     `matched_count=0` (spec.md's explicit "not an error" distinction —
     the one easiest bug to introduce here); unrecognized sector reported,
     universe unaffected by it otherwise; per-match `node_evaluations`
     keyed correctly; stateless — same request run twice reproduces
     identical problems/output (AC7) with no setup/call-order dependency.
   - `tests/functional/test_screener_routes.py` (new, mirrors
     `test_backtest_routes.py`'s `TestClient`-against-real-`app` style with
     `app.state` monkeypatched) — HTTP-level: 200 body shape for
     complete/refused/valid, 503 when no panel loaded.
