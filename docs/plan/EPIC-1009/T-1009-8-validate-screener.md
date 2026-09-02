# T-1009-8: `validate_screener` tool

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Done
**Depends on**: T-1009-2, T-1009-5, T-1009-6
**Blocks**: T-1009-10

## Description

A dry run for a screener: everything that can be known without executing
it. Reports invalid parameters, data that will not be there, filters that
cannot both hold, queries that will be expensive, and universes that are
empty — so an agent fixes the screen before spending a query on it, and a
human sees why a screen returned nothing before it runs.

## User Story

As an AI agent about to run a screen,
I want a check that tells me what is wrong with it and how badly,
so that I correct a contradiction or a missing field on this turn instead
of interpreting an empty result as a market fact.

## Acceptance Criteria

1. Validating a well-formed screener reports it as valid with no blocking
   problems and states the screener revision that was validated.
2. A condition parameter outside its catalog item's declared valid range
   produces a blocking problem naming the node ID, the parameter, and the
   permitted range.
3. A field or event calendar unavailable for part of the universe produces
   a problem naming the field, the affected part of the universe, and
   whether it blocks execution or merely degrades coverage.
4. Two conditions that cannot both hold — such as disjoint ranges on the
   same field combined under `AND` — produce a problem naming the
   conflicting node IDs and explaining why nothing can satisfy both.
5. A screener whose estimated execution cost exceeds the configured budget
   produces a non-blocking warning reporting the estimate and the main
   driver of it.
6. A universe resolving to zero instruments produces a blocking problem
   reporting the empty universe and which criterion eliminated everything.
7. Disabled nodes produce no problems and are reported as skipped.
8. Validation mutates nothing: no screener field changes and the workspace
   revision does not advance.
9. Multiple independent problems are all reported in one response rather
   than only the first.
10. Tests cover the clean case, each problem class above, disabled-node
    skipping, multiple simultaneous problems, and the no-mutation
    guarantee.

## Design References

- `docs/design/screener-core/spec.md` — the "Validate a screener"
  scenario table; each AC traces to a row. Open Question 2 covers the
  cost budget.
- `docs/design/screener-core/technical.md` — the validation problem
  shape (severity, code, affected IDs, explanation).
- `backend/api/routes/research.py` — existing FastAPI route, schema, and
  error-mapping conventions for a networked tool.

## Technical Considerations

- Contradiction detection needs to be useful without being a theorem
  prover. Cover the tractable and common cases — disjoint ranges and
  mutually exclusive scalar bounds on the same field under `AND` — and
  say plainly in the response that detection is not exhaustive.
- Data-availability answers come from EPIC-1008's catalog registry.
- The cost estimate is an estimate; report it as one, with its budget, so
  the agent can decide rather than be blocked.

## Out of Scope

Executing the screener (T-1009-9), and the evaluation engine itself
(T-1009-7).

## Solution Approach

### Modules

- `src/lib/screener/screenerValidation.ts` (domain) -- the public entry
  point, `validateScreenerDefinition(screener, options?)`. Walks the filter
  tree once: delegates per-condition catalog checks to
  `conditionValidation.ts`'s `validateCondition` (AC2), adds a
  data-availability pass over every catalog ID a condition reads (AC3,
  `unavailable` blocks, `partial` is advisory), skips disabled subtrees
  entirely while still recording their node IDs (AC7), and assembles the
  cost estimate (AC5) and empty-universe check (AC6). Exports
  `ScreenerValidationOptions` (`registry?`, `marketData?`, `costBudget?`)
  and the documented defaults `DEFAULT_COST_BUDGET_INSTRUMENT_DAYS`
  (5,000,000 instrument-days -- spec.md Open Question 2),
  `DEFAULT_LOOKBACK_DAYS` (252, one trading year) and
  `DEFAULT_ASSUMED_UNIVERSE_SIZE` (8,000, used only for the cost estimate
  when the universe can't be resolved).
- `src/lib/screener/screenerValidation.contradictions.ts` (domain) -- split
  out to stay under the 400-line file limit. Exports
  `detectGroupContradictions(siblings)`: reduces range and numeric-scalar
  (`op.greater_than`/`op.less_than`/`op.equals`) conditions on the same
  field to a numeric bound and flags disjoint pairs (AC4). Not a theorem
  prover by design -- only direct enabled condition-node siblings of one
  enabled `and` group are compared; `ScreenerValidationReport
  .detectionExhaustive` is always `false`.
- `src/lib/webmcp/screener/validateScreener.ts` (API layer) -- the
  `validate_screener` tool. Resolves the workspace/screener from
  `WorkbenchDeps.repository`, calls `validateScreenerDefinition`, and
  serializes the report to snake_case wire keys. No `mutate()` callback, no
  `RevisionService`, no `expected_revision`/`idempotency_key` input (AC8).
  Exports `createValidateScreenerTool(deps, options?)` where `options` is
  `{ registry?, marketData?, costBudget? }`.

### Test plan

- `screenerValidation.test.ts` (14 tests) exercises
  `validateScreenerDefinition` directly against the real built-in catalog
  (`field.price.close`, `field.volume`, `field.market_cap`) plus one fixture
  registry override for a `partial`-availability field (the seeded inventory
  has no such item). Covers: AC1 clean pass with revision reported, AC2
  delegation (out-of-range parameter), AC3 both arms (blocking
  `unavailable`, advisory `partial`), AC4 both tractable contradiction
  shapes (disjoint ranges, mutually exclusive scalar bounds), AC5 (advisory
  over-budget warning plus the documented default budget), AC6 both arms
  (blocking empty universe with injected market data, "never claims zero"
  without it), AC7 (disabled leaf, disabled group skipping its whole
  subtree), AC9 (three independent problems in one response), and AC8's
  no-mutation guarantee at the domain level (screener object byte-for-byte
  unchanged).
- `validateScreener.test.ts` (7 tests) exercises the tool through an
  in-memory `WorkspaceRepository` (`createLocalWorkspaceRepository(
  memoryStorage())`, the pattern `setScreenerRanking.test.ts` uses): a clean
  pass reporting the screener ID/revision, snake_case wire shape, unknown/
  missing `screener_id` and no-active-workspace rejections, and AC8 at the
  tool level (workspace revision and screener revision unchanged
  before/after, stored document deep-equal, and no change-history entry
  appended).
