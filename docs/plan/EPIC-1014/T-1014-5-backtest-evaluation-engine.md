# T-1014-5: Backtest evaluation engine

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Done
**Depends on**: — (consumes EPIC-1008's market-data ports and EPIC-1009's
screener definition)
**Blocks**: T-1014-6
**Issue**: —

## Description

Build the engine that evaluates a screener definition against history:
how often it matched over time, what happened to the matches over a set
of forward horizons, how deep the drawdowns went, and — stated in plain
terms rather than buried — what survivorship assumption the numbers rest
on.

This is the substantive half of backtesting and it lives in the Python
backend alongside the existing forward-return and base-rate machinery.
T-1014-6 puts the two tools on top of it. Splitting them keeps the
statistics testable against fixtures without a browser in the loop, which
is the only way the survivorship and lookahead guarantees get properly
covered.

## User Story

As a researcher about to trust a screen,
I want to know how often it fired historically, what happened next, and
which assumptions the answer depends on,
so that I can tell a real edge from a screen that only looks good because
the losers were quietly excluded.

## Acceptance Criteria

1. Given a screener definition, a universe, a historical date range, and
   one or more forward-return horizons, the engine produces: match
   frequency over time, a forward-return distribution per horizon, and
   drawdown statistics for the matched instruments.
2. Every result states its survivorship assumption in plain terms —
   whether delisted, merged, and renamed instruments were included, and
   what effect that has on the reported numbers.
3. Every result states the universe, the date range actually covered, the
   horizons evaluated, and the calculation-engine version, alongside the
   market-data provenance (`as_of`, source, live/delayed status,
   timezone, currency, price adjustment policy, and fundamentals
   reporting period where fundamentals were used).
4. A screener condition that references data not knowable at the
   historical decision date is either rejected or evaluated on an
   explicit lag, and the result warns that a lookahead risk was found and
   states how it was handled.
5. Point-in-time correctness is enforced for fundamentals: a condition on
   reported figures uses the figures as they were known at the decision
   date, not as later restated, or the result warns that it could not.
6. When the requested range or universe has too little history to support
   the requested horizons, the evaluation is rejected or truncated, with
   a warning naming the coverage actually available.
7. A screener that matched nothing over the range produces a zero-match
   result stating the range and universe, not an error.
8. Rebalance or evaluation frequency is explicit in the result — the
   reader can tell on what schedule the screen was evaluated.
9. The engine reads market data exclusively through the data ports; it
   contains no provider-specific access and no data pipeline of its own.
10. The engine is deterministic: the same definition, range, and fixture
    data produce identical results across runs.
11. The engine follows the project's layered architecture — the
    evaluation logic carries no infrastructure imports — and lives in new
    files that change no existing module's behavior.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Backtest a screener"
  and "Read backtest results" scenario tables.
- `docs/reference/tool-spec.md` — `backtest_screener` /
  `get_backtest_results` ("historical frequency, forward returns,
  drawdowns, and survivorship assumptions"); the market-data provenance
  requirement every result must carry.
- `docs/plan/EPIC-1009/_epic.md` — the screener definition, universe, and
  filter tree being evaluated.
- `docs/plan/EPIC-1008/_epic.md` — the domain ports for reference,
  fundamental, and price history data.
- `backend/domain/`, `backend/domain/contracts/engine.py`,
  `backend/infra/pandas_engine.py` — the existing layered engine and its
  forward-return, hit-rate, and base-rate statistics; the pattern to
  follow and the closest prior art in the repo.
- `backend/tests/unit/test_query_engine_stats.py` — the existing
  statistics test style and fixture approach.

## Technical Considerations

- Survivorship is the finding, not a footnote. If the available data has
  no delisted instruments, the correct behavior is to say so loudly in
  every result, not to omit the field.
- Lookahead bias hides in fundamentals (restatements) and in any
  condition referencing a future-dated event. Both need explicit handling
  and explicit reporting.
- Real history depends on the parallel market-data workstream. Build and
  test against fixtures through the ports; do not build a mock pipeline.
- Backtests over long ranges and wide universes are expensive. Bound the
  work and report the bound rather than running unbounded.
- The calculation-engine version has to change when the statistics
  change, or provenance is decorative.

## Out of Scope

- The `backtest_screener` and `get_backtest_results` tools, job
  lifecycle, and result storage (T-1014-6).
- Portfolio simulation: position sizing, capital allocation, transaction
  costs, slippage, and P&L. This engine evaluates the screen's historical
  behavior, not a trading strategy.
- Any visualization of backtest results.
- Building the live market-data pipeline.

## Solution Approach

### Binding architecture note (read this first)

EPIC-1008 and EPIC-1009 are implemented **entirely in browser-side
TypeScript** (`src/lib/discovery/`, `src/lib/catalog/`, `src/lib/screener/`).
Both epics' own ticket docs say so explicitly — T-1009-1 and T-1009-2 each
carry a "Location note" / "Binding architecture note" stating that
`backend/domain/contracts/engine.py` is cited as the *Protocol-in-domain /
adapter-in-infra pattern*, not an actual location, and that the real
screener definition, filter tree, and market-data ports live in
`src/lib/screener/definition.ts`, `conditions.ts`, and `ports.ts`. There is
no Python-side screener definition model, catalog, or market-data port
anywhere in `backend/` today — only the unrelated, older
`PatternResearchEngine` (EPIC-0001) and the new `SimilarityEngine`
(EPIC-1012), which reads the OHLCV panel directly, not through a
reference/fundamentals port.

This ticket is explicit that the backtest engine "lives in the Python
backend alongside the existing forward-return and base-rate machinery," so
this is not a case of skipping the Python side — it is a case of there
being nothing on the Python side yet to consume. Per the workflow
instructions, extending *already-merged* sibling-epic code is off-limits
without a stop-and-report; this is different — EPIC-1008/1009 explicitly
never built a Python artifact, by their own tickets' design. Building one
here, scoped to what this engine needs, is this ticket's own job, not a
cross-epic change to someone else's merged work.

Consequently this ticket:

1. Defines a **new** Python domain model for the screener filter tree
   (`domain/models/screener.py`), field-for-field compatible with
   `src/lib/screener/conditions.ts`'s eight condition variants (same
   variant names and fields, snake_cased), so a future ticket (T-1014-6 or
   later) can losslessly translate a TS `ScreenerDefinition` into this
   shape when it builds the HTTP boundary — mirrored the same way EPIC-1012
   mirrors TS similarity concepts in `domain/models/similarity.py`.
2. Defines **new** Python domain ports (`domain/contracts/market_data.py`)
   for price series, fundamentals, and reference/corporate-actions data —
   the "market-data ports" the ticket refers to — modeled after the
   existing `PriceSource`/`PanelStore` port style, built and tested purely
   against fixtures (fakes implementing the Protocols), per the ticket's
   own Technical Considerations ("do not build a mock pipeline").
3. Does **not** implement chart-pattern recognition or arbitrary
   user-authored study output evaluation (the `pattern` and `study_output`
   condition families) against real data — those require the catalog's
   study/pattern engine, which is TS-only. Instead these two families are
   *structurally* evaluable through the model (they round-trip, they are
   walked by lookahead detection) but their runtime evaluation reports an
   explicit "not evaluable through the available data ports" outcome
   (fails closed, never fabricates a match) and the run carries a warning
   naming the affected node IDs — the same "explicit unavailable, never
   placeholder" convention `domain/panel_disclosure.py` and EPIC-1008's
   AC5 already use elsewhere in this project. `relative` conditions are
   fully evaluated for the `own_moving_average` baseline only;
   `peer_group`/`index` baselines get the same explicit-unavailable
   treatment, for the same reason (no peer-group/index-level port exists).

### Why the concrete engine lives in `domain/`, not `infra/`

The closest prior art (`PatternResearchEngine` Protocol in
`domain/contracts/engine.py`, concrete `PandasPatternResearchEngine` in
`infra/pandas_engine.py`) splits Protocol from implementation because the
concrete implementation needs pandas/numpy over an in-memory panel. This
engine's orchestration needs no such library: it only calls the Protocol
ports it depends on and does its own arithmetic with the standard library
(`statistics`, plain loops) — exactly the "policy, no I/O" split
`domain/universe_floor.py` documents for itself. Since AC11 requires "the
evaluation logic carries no infrastructure imports," and the concrete
engine class literally has none (no `from infra...` anywhere, no
pandas/numpy), it is placed in `domain/backtest_engine.py` next to its
Protocol in `domain/contracts/backtest_engine.py`, constructed with
Protocol-typed ports injected by the caller (T-1014-6, later, wiring real
or fixture adapters). This is a deliberate deviation from the
Protocol-in-domain/impl-in-infra split used by `PatternResearchEngine` and
`SimilarityEngine` — documented here because it is a departure from the
"closest prior art," not an oversight.

### New files

**`backend/domain/models/screener.py`** — pure Pydantic models, no I/O:

- `UniverseSpec` — `universe_id`, `label`, explicit `tickers: list[str] |
  None` (None means "resolved by the reference port from the other
  fields"), `min_price`, `min_avg_volume`, `min_market_cap`,
  `excluded_tickers`. A deliberately smaller mirror of TS's `UniverseSpec`
  (no sectors/industries/indexes/exchanges — nothing in this repo's Python
  side classifies those yet); extending it is additive and does not
  require touching this ticket's engine logic.
- `SeriesRef { catalog_id: str; params: dict[str, float | str | bool] }`
- Eight condition variants as a discriminated union on `type`: `ScalarCondition`,
  `RangeCondition`, `SeriesComparisonCondition`, `TemporalCondition`
  (recursive: wraps an inner `Condition`), `EventRelativeCondition`,
  `PatternCondition`, `RelativeCondition`, `StudyOutputCondition` — same
  field names as `conditions.ts`, snake_cased (`fieldId` → `field_id`,
  `withinBars` → `within_bars`, etc.). `RelativeBaseline` as a discriminated
  union (`own_moving_average` / `peer_group` / `index`).
- `FilterNode = GroupNode | ConditionNode`, `GroupNode { node_id, op: and
  | or | not, children: list[FilterNode], enabled }`, `ConditionNode {
  node_id, condition: Condition, enabled }` — same shape as
  `definition.ts`.
- `FieldClass` enum: `PRICE`, `FUNDAMENTAL`, `EVENT` — drives lookahead and
  point-in-time handling (AC4/AC5); not present in the TS model because TS
  never evaluates historically, so this is a genuinely new concept this
  engine needs, not a mirrored one.

**`backend/domain/contracts/market_data.py`** — new Protocols, domain
layer, no infra import:

- `PriceSeriesPort` — `get_series(ticker, series_ref, from_date, to_date)
  -> list[SeriesObservation]` (raw OHLCV fields and price-derived studies
  such as moving averages are both "price class": always known as of their
  own bar date, no lookahead risk) and `get_bars(ticker, from_date,
  to_date) -> list[PriceBar]` for forward-return/drawdown computation.
- `FundamentalsPort` — `field_ids() -> frozenset[str]` (which field IDs
  this source can serve — the classification signal AC5 needs),
  `supports_point_in_time() -> bool`, `get_reported_value(ticker,
  field_id, as_of) -> ReportedValue | None`, where `ReportedValue` carries
  `value`, `fiscal_period`, and `reported_date` (the date the figure
  became public) so the engine can enforce "known as of the decision
  date, not as later restated" (AC5) by filtering on `reported_date <=
  as_of`.
- `ReferenceDataPort` — `includes_delisted()`, `includes_merged()`,
  `includes_renamed()` (capability flags — the survivorship statement,
  AC2, is built from these, not inferred from whether any events happen to
  appear), `get_universe_members(as_of, universe) -> list[str]` (point-in-
  time universe membership — this is what makes survivorship real instead
  of decorative: membership is asked for *as of* each rebalance date, not
  read once from today's universe), `get_delisting_events(from_date,
  to_date) -> list[DelistingEvent]`, `get_event_occurrences(ticker,
  event_type_id, from_date, to_date) -> list[EventOccurrence]` where
  `EventOccurrence` carries `event_date` and `known_as_of` (when the market
  first knew — the field `event_relative` lookahead detection keys off).

**`backend/domain/contracts/backtest_engine.py`** — `BacktestEngine`
Protocol: one method, `run(request: BacktestRequest) -> BacktestResult`.

**`backend/domain/models/backtest.py`** — `BacktestRequest` (screener_id,
revision, filter_tree, universe, from_date, to_date, horizons: list[int],
rebalance: `RebalanceFrequency` enum [`daily`, `weekly`, `monthly`]),
`BacktestResult` (echoes universe/range-requested/range-covered/horizons/
rebalance, `match_frequency: list[MatchFrequencyPoint]`,
`forward_returns: list[ForwardReturnDistribution]` (one per horizon),
`drawdown: DrawdownStats`, `survivorship: SurvivorshipAssumption`,
`provenance: BacktestProvenance`, `warnings: list[BacktestWarning]`,
`match_count_total: int`), plus the supporting result models
(`MatchFrequencyPoint`, `ForwardReturnDistribution`, `DrawdownStats`,
`SurvivorshipAssumption`, `BacktestProvenance`, `BacktestWarning`).
`domain.models.similarity.MarketDataProvenance` (EPIC-1012) already
carries exactly AC3's `as_of`/source/live-or-delayed/timezone/currency/
price-adjustment/engine-version fields with every field mandatory
(construction fails without them) — reused as-is rather than redefined,
per the project's "don't reinvent an existing contract" convention.
`BacktestProvenance` wraps it (`market_data: MarketDataProvenance`) and
adds only the one field AC3 needs that similarity's provenance has no
reason to carry: `fundamentals_reporting_period: str | None` (set only
when a fundamentals field was actually used by the request's filter
tree). `market_data.engine_version` is set to `BACKTEST_ENGINE_VERSION`.

**`backend/domain/backtest_stats.py`** — pure statistics, stdlib only
(`statistics` module, plain loops; no pandas/numpy, matching every other
`domain/` module): `summarize_returns(returns: list[float]) ->
ForwardReturnDistribution` (count/mean/median/hit_rate — same shape as
`pandas_engine._summarize_returns`, ported to pure Python), `max_drawdown(
closes: list[float]) -> float` (peak-to-trough over one price path),
`aggregate_drawdowns(per_instance: list[float]) -> DrawdownStats`.

**`backend/domain/lookahead.py`** — pure: `classify_condition(condition,
field_class_of: Callable[[str], FieldClass]) -> LookaheadFinding | None`
walks a single condition (recursing into `temporal`'s inner condition) and
flags: any `event_relative` with `direction="future"` (AC4's central
example — a future event is not knowable at the decision date unless
explicitly lagged), and any condition referencing a `FUNDAMENTAL`-class
field (AC5). Returns `None` for conditions with no lookahead exposure.
Does not touch a port itself — `field_class_of` is a plain callable the
engine builds once from `FundamentalsPort.field_ids()`, keeping this
module I/O-free and trivially unit-testable.

**`backend/domain/filter_evaluation.py`** — pure per-condition evaluator:
`evaluate_condition(node, ticker, as_of, resolver: FieldResolver) -> bool
| None` (`None` = "not evaluable," for `pattern`/`study_output` and
unsupported `relative` baselines/operators — fails closed at the group
level, never counted as a pass). `FieldResolver` is a small dataclass of
plain callables (`price_value`, `fundamental_value`, `event_known_as_of`)
the engine builds from the three ports once per run — keeping this module
free of Protocol imports so its tests can use bare lambdas instead of
fake port classes.

**`backend/domain/backtest_engine.py`** — `PortBacktestEngine`, the
`BacktestEngine` Protocol's implementation. `run()`, kept under the
project's ≤50-line use-case guidance by delegating to private helpers:

1. Bound the request against `MAX_RANGE_SESSIONS` / `MAX_UNIVERSE_SIZE`
   constants (AC6/Technical Considerations "bound the work and report the
   bound") — truncate `to_date`/universe and record a coverage warning
   rather than reject outright, unless truncation would leave zero
   evaluable sessions, in which case it rejects
   (`InsufficientHistoryError`).
2. Classify every condition node's lookahead exposure once
   (`lookahead.classify_condition`) and build the run's lookahead
   warnings (AC4) before any date is walked.
3. Step rebalance dates via `domain.trading_calendar.sessions_between`
   filtered to the requested frequency (weekly = Fridays, monthly =
   last session of the month) — this is what makes rebalance frequency
   explicit and inspectable (AC8): it is a field on the result, not an
   implementation detail.
4. At each rebalance date, resolve universe membership *as of that date*
   from `ReferenceDataPort` (point-in-time, not today's membership — this
   is what makes the survivorship statement true rather than aspirational)
   and evaluate the filter tree per ticker via `filter_evaluation`,
   recording matches.
5. For every match, pull forward returns per horizon
   (`PriceSeriesPort.get_bars`) and the matched instrument's own
   max-drawdown over the horizon window, feeding `backtest_stats`.
6. Assemble `SurvivorshipAssumption` from the `ReferenceDataPort`
   capability flags plus the delisting events actually observed in range
   (AC2 — states the assumption "in plain terms," e.g. "This universe
   source includes delisted instruments; N of the M matched tickers were
   later delisted, so returns include their full outcome" vs. "This
   universe source does not include delisted instruments; screens run
   over survivorship-biased history and may overstate historical
   performance" when the port's capability flag is `False` — the
   survivorship statement changes with the port's declared capability,
   not with what fixture happens to be wired in per test).
7. Assemble `ProvenanceEnvelope` from a `MarketDataProvenance`-shaped
   value each port exposes (`as_of`/`source`/`is_delayed`/`timezone`/
   `currency`/`price_adjustment`, `fundamentals_reporting_period` only
   when a fundamentals field was actually used) plus
   `BACKTEST_ENGINE_VERSION`.
8. Zero matches (AC7) short-circuits after step 4 into a `BacktestResult`
   with empty `match_frequency`/`forward_returns`/zeroed `drawdown`,
   stating the range/universe — never an error.

`BACKTEST_ENGINE_VERSION` is a module-level constant bumped whenever the
statistics/lookahead/survivorship rules in this file, `backtest_stats.py`,
or `lookahead.py` change — documented at its definition site so the "has
to change when the statistics change" rule in Technical Considerations is
enforceable in review rather than a promise.

### Determinism (AC10)

No `random`, no wall-clock reads inside the engine (the caller supplies
`as_of` for provenance), no dict/set iteration order dependency in any
result-ordering path (match lists sorted by `(date, ticker)`; warnings
appended in a fixed, code-driven order). Verified by a test that runs the
same request against the same fixture ports twice and asserts
`result_a == result_b` (Pydantic model equality).

### Test plan

- `backend/tests/unit/test_backtest_stats.py` — `summarize_returns` and
  `max_drawdown`/`aggregate_drawdowns` against hand-computed fixtures
  (empty input, all-losers, all-winners, a known drawdown path).
- `backend/tests/unit/test_lookahead.py` — `event_relative`
  direction=`future` flags a finding, direction=`past` does not; a
  `FUNDAMENTAL`-class field flags a finding, a `PRICE`-class field does
  not; `temporal` recurses into its inner condition.
- `backend/tests/unit/test_filter_evaluation.py` — one test per evaluable
  condition family against a stub `FieldResolver`, plus `pattern` and
  `study_output` returning `None` (not evaluable), plus a `relative`
  condition with a `peer_group` baseline also returning `None`.
- `backend/tests/unit/test_backtest_engine.py` — end-to-end against fake
  in-memory ports (fixtures, not a mock pipeline): a screener that matches
  a known synthetic price path produces the expected match frequency,
  forward-return distribution, and drawdown; a screener with an
  always-false condition produces AC7's zero-match result; a
  `ReferenceDataPort` fake with `includes_delisted=False` versus one with
  `includes_delisted=True` and a seeded delisting event produce visibly
  different survivorship statements from the same price fixture; a
  request whose horizon exceeds the fixture's available history is either
  truncated or rejected with a coverage warning naming the actual
  coverage; the lookahead scenario (a screener using an
  `event_relative`/`direction=future` condition) produces the AC4 warning
  and either rejects the condition or evaluates it lagged, provably (a
  variant of the same fixture where the future event is moved earlier
  changes the match set, proving the lag is real and not decorative);
  determinism test (two runs, equal results). Each new test is checked to
  fail when its corresponding logic is reverted, per the workflow's
  mutation-check requirement.

### Out of scope carried forward from the ticket

Full catalog-backed evaluation of `pattern`/`study_output` conditions and
`relative`'s `peer_group`/`index` baselines (needs the TS-only catalog);
an HTTP boundary or WebMCP tool (T-1014-6); persistence of results
(T-1014-6); anything the ticket's own Out of Scope section already
excludes.
