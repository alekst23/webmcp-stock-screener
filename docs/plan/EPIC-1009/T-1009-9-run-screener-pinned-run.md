# T-1009-9: `run_screener` with pinned run store

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: T-1009-7
**Blocks**: T-1009-10

## Description

Execute one specific screener revision and pin the result. The pinning is
the point: the returned `run_id` names a stored, ordered, complete result
set with a fixed data timestamp, so EPIC-1010 can page through it later
without silently re-running the screen and quietly changing the numbers
underneath a conversation the human is still having.

## User Story

As an AI agent that just ran a screen,
I want a stable handle to exactly the results I ran, with the data
timestamp attached,
so that when the human asks about result 40 twenty minutes later, they
see the row I saw, not a different one from a fresh query.

## Acceptance Criteria

1. Running a valid screener creates a run with a stable `run_id` and
   returns the screener ID, the screener revision executed, the universe
   count, the matched count, the returned count, warnings, and the data
   timestamp.
2. The run records the exact screener revision executed; editing the
   screener afterwards does not change what that run reports or contains.
3. A caller may name an explicit screener revision to run; if that
   revision is no longer retained the call is rejected rather than
   silently running a different one.
4. The complete ordered match list, with per-match ranking values and
   per-node evaluated values and pass/fail states, is stored under the
   `run_id` and can be read back without re-executing the screener.
5. A read of a run that no longer exists fails explicitly as "run no
   longer available"; it never falls back to re-running the screener.
6. Every run reports full provenance: `as_of`, source, live/delayed
   status, timezone, currency, price adjustment, the fundamentals
   reporting period for any fundamental field used, and the
   calculation-engine version.
7. A screener with blocking validation problems is refused: the problems
   are returned, no `run_id` is minted, and nothing is stored.
8. A valid screener that nothing satisfies produces a run with a matched
   count of zero and a warning — a normal result, not an error.
9. When matches exceed the result limit, the run reports the total matched
   count, the returned count, and that the result was truncated.
10. The tool accepts `expected_revision` and `idempotency_key`; a replayed
    key returns the original `run_id` without executing a second time.
11. Run retention is explicit and documented — how many runs are kept and
    for how long — and eviction is observable through AC5's error rather
    than through changed numbers.
12. Tests cover a successful run, pinning across a subsequent screener
    edit, explicit-revision runs, read-back without re-execution, the
    evicted-run error, refusal on blocking problems, zero matches,
    truncation, and idempotent replay.

## Design References

- `docs/design/screener-core/spec.md` — the "Run a screener" scenario
  table, and Open Question 1 on run retention.
- `docs/design/screener-core/technical.md` — the `ScreenerRun` contract
  and what a run stores for EPIC-1010; this ticket is the producing half
  of that contract.
- `backend/api/routes/research.py` — existing route and error-mapping
  conventions.

## Technical Considerations

- The run store is the contract boundary with EPIC-1010. Whatever its
  storage mechanism, the read path must be able to answer "this run is
  gone" distinctly from "this run has no matches".
- Coordinate the retention decision with EPIC-1010 rather than assuming
  it; the spec's Open Question 1 records the current assumption.
- The idempotency guarantee here matters more than elsewhere: a replayed
  run key must not execute a second query.

## Out of Scope

Paging, selecting, formatting, or explaining results (EPIC-1010), and
exporting or backtesting a run.

## Solution Approach

Two new modules, each with its `*.test.ts` alongside. Both consume the
already-landed cross-epic contract (`src/lib/screener/run.ts`,
`src/lib/screener/ports.ts`, `src/lib/screener/engine/engine.ts`,
`src/lib/screener/screenerValidation.ts`) without modifying it.

### `src/lib/screener/runStore.ts`

Domain-adjacent infra implementing `ports.ts`'s `PinnedRunStore`. Does not
import from `src/lib/webmcp/`.

```ts
export interface PinnedRunStoreOptions {
	policy?: RunRetentionPolicy; // defaults to ports.ts's keepAllRuns
	now?: () => Date; // defaults to the wall clock
}
export function createPinnedRunStore(options?: PinnedRunStoreOptions): PinnedRunStore
```

- Backing storage: `Map<ResourceId, ScreenerRun>`, insertion-ordered.
- Current retention policy (spec.md Open Question 1's working assumption,
  restated here per T-1009-9's instructions): **runs are retained for the
  life of the workspace session; nothing is evicted by default** ---
  `createPinnedRunStore()` defaults to `keepAllRuns`. The policy is a
  constructor parameter, not a hard-coded rule, so the cross-epic decision
  can change later without touching a call site or this file.
- `getRun`/`getMatches` run an eviction sweep (`policy.shouldEvict(run, now,
  index)`, `index` 0 = most recently stored) before reading. A `runId` this
  store swept away is remembered in a separate `evictedIds` set so a later
  read reports `reason: 'evicted'`, distinguishable from `reason: 'unknown'`
  (a `runId` this store never minted). This is what keeps AC5/AC11 true even
  under a non-default, always-evicting policy.
- `putRun` is the only way a run enters the store and is a plain synchronous
  write -- no execute/refresh method exists anywhere on this module, which is
  the structural half of EPIC-1010's "no silent rerun" guarantee ports.ts
  already documents.
- `getMatches(runId, offset, limit)` slices the stored run's `matches`
  array; it does not re-rank or re-evaluate anything.

### `src/lib/webmcp/screener/runScreener.ts`

The `run_screener` tool. Orchestrates only -- reads the screener, mints a
`run_` id, calls `ScreenerEvaluationPort.execute`, stores the outcome, shapes
the wire response. Every field the engine computes (matches, warnings,
provenance, ranking) passes through untouched.

```ts
export interface RunScreenerToolOptions {
	registry?: CatalogRegistry; // defaults to builtinCatalogRegistry
	marketData?: ScreenerMarketData; // defaults to createUnavailableMarketData()
	costBudget?: number; // forwarded to validateScreenerDefinition
	evaluationPort?: ScreenerEvaluationPort; // defaults to createScreenerEngine({...}); injectable so tests can wrap a counting fake
	runStore?: PinnedRunStore; // defaults to createPinnedRunStore()
	now?: () => Date; // forwarded to the default engine
}
export function createRunScreenerTool(deps: WorkbenchDeps, options?: RunScreenerToolOptions): ToolSpec
```

Wire input (snake_case): `workspace_id?`, `screener_id` (required),
`screener_revision?` (explicit *screener* revision -- `ScreenerDefinition.
revision`, distinct from the workspace revision), `expected_revision?`
(workspace-level optimistic concurrency, matching every other tool),
`idempotency_key?`.

Flow, mirroring `save_workspace`'s bypass-of-`RevisionService.commit`
pattern since a run does not advance the workspace revision:

1. Resolve `workspace_id` (private `resolveWorkspaceId`, same shape as the
   other screener tools -- not imported from `workbench/tools/index.ts`).
2. Validate `screener_id` is present.
3. Compute a fingerprint (`fingerprintRequest('screener.run_screener', {...})`)
   over `{workspaceId, screenerId, screenerRevision, expectedRevision}`. If
   `idempotency_key` is set, look it up in a small private replay cache
   (module-private, not `WorkbenchDeps.idempotency` -- that cache is typed to
   `MutationEnvelope`, which a `ScreenerRun` is not, and this ticket must not
   change `idempotency.ts`'s shared type to fit). A cache hit returns the
   previously computed `ToolResult` immediately -- **the evaluation port is
   never called on replay** (AC10). A fingerprint mismatch throws
   `IdempotencyConflictError`, same failure shape as every other tool.
4. Load the workspace document; missing workspace -> `fail('not_found')`.
5. `expected_revision` mismatch -> `RevisionConflictError` (same as
   `save_workspace`).
6. Missing screener -> `fail('not_found')`.
7. Resolve the `ScreenerDefinition` to execute: if `screener_revision` is
   omitted or equals the current screener's revision, use the current
   screener. Otherwise search `WorkspaceRepository.listRevisions(workspaceId)`
   for a past workspace-revision snapshot whose screener
   (`readScreener(snapshot, screenerId)`) has that exact `revision`. None
   found -> `OperationValidationError` naming the screener and revision (AC3
   -- "no longer retained", never falls back to a different revision).
8. Mint `run_id` via `deps.ids.next('run')`.
9. Call `evaluationPort.execute({ definition, runId })`.
   - `status: 'refused'`: shape the refusal (`status`, `screener_id`,
     `screener_revision`, `problems`) and return `ok(...)` -- a refusal is a
     well-formed answer, not a tool failure, mirroring `validate_screener`'s
     `valid: false` convention. **`runStore.putRun` is not called** (AC7:
     nothing stored, no `run_id` minted for callers to address -- the minted
     `run_id` is simply discarded).
   - `status: 'complete'`: `runStore.putRun(outcome)`, then
     `ok(toWireScreenerRun(outcome))` (AC1/AC4/AC6/AC8/AC9 all fall out of
     `run.ts`'s own contract -- this tool does not re-derive any of those
     fields).
10. If `idempotency_key` was set, remember the computed `ToolResult` in the
    replay cache (success or refusal alike) -- matching
    `RevisionService.commit`'s rule that nothing is recorded until a request
    actually completes past validation.

Default wiring: `evaluationPort` defaults to
`createScreenerEngine({ marketData, registry, validateDefinition: (d) =>
validateScreenerDefinition(d, { registry, marketData, costBudget }), now })`
-- this is what makes AC7 use the *rich* validator (contradictions, cost,
empty universe) rather than `engine.ts`'s minimal structural default.

### Test plan

`runStore.test.ts`:
- `test_getRun_unknownId_reportsUnknown`
- `test_getRun_afterPutRun_returnsStoredRunUnchanged`
- `test_getMatches_offsetAndLimit_slicesStoredMatches`
- `test_getRun_zeroMatchRun_isDistinguishableFromRunNotAvailable`
- `test_getRun_defaultPolicy_neverEvicts` (keepAllRuns)
- `test_getRun_withAlwaysEvictPolicy_reportsEvictedReason` (injected
  always-evict `RunRetentionPolicy`, asserting `reason: 'evicted'` and that
  it differs from `'unknown'` for a truly never-stored id)
- `test_putRun_isTheOnlyWriteOperation` (structural: `PinnedRunStore`'s type
  has no execute/refresh member -- asserted by exhaustively listing the
  object's own keys)

`runScreener.test.ts` (private in-memory `WorkspaceRepository` test seam
follows `setScreenerRanking.test.ts`'s pattern: real
`createLocalWorkspaceRepository` over `workbench/testSupport`'s
`memoryStorage()`, real `RevisionService`/`ChangeHistory`/`IdSequencer`, a
fake `ScreenerMarketData`/`ScreenerEvaluationPort` built locally):
- `test_runScreener_validScreener_createsRunWithSummary` (AC1)
- `test_runScreener_screenerEditedAfterRun_runStaysPinned` (AC2 -- run, then
  a real `edit_filter_tree`-equivalent mutation via `writeScreener`/
  `recordCommit`, then read the run back byte-identical)
- `test_runScreener_explicitRetainedRevision_runsThatRevision` (AC3)
- `test_runScreener_explicitUnretainedRevision_isRejected` (AC3)
- `test_runScreener_readRunAfterExecute_doesNotReexecute` (AC4/AC5, counting
  fake evaluation port)
- `test_runScreener_evictedRun_reportsRunNotAvailable` (AC5/AC11, injected
  always-evict policy on the store)
- `test_runScreener_blockingProblems_refusesAndMintsNoRun` (AC7 -- asserts
  `runStore.getRun` is `unknown` for every id and the store is otherwise
  empty)
- `test_runScreener_nothingMatches_reportsZeroMatchedWithWarning` (AC8)
- `test_runScreener_overLimit_reportsTruncated` (AC9)
- `test_runScreener_replayedIdempotencyKey_returnsOriginalRunWithoutSecondExecution`
  (AC10, counting fake engine asserting `execute` called exactly once across
  two calls)
- `test_runScreener_staleExpectedRevision_isRejected` (revision-conflict
  guard, mirroring `save_workspace`)
