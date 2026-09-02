# T-1010-5: Result explanation use case (`explain_result`)

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Done
**Depends on**: T-1010-2, T-1010-3
**Blocks**: T-1010-7

## Description

Orchestrate answering "why this instrument?" for a pinned run: read the
run's stored evaluation for one instrument through the read-only contract
and assemble the full filter-by-filter explanation and ranking-contribution
breakdown. Like the results read, it must never execute a screener.

## User Story

As a researcher auditing a screener,
I want to ask about any instrument the run looked at and get every
filter's actual value and verdict plus its ranking contribution,
so that I can confirm the screener is doing what I think it is — and find
out precisely which condition eliminated a stock I expected to see.

## Acceptance Criteria

1. Given a pinned `run_id` and a stable instrument ID, an explanation is
   returned containing every leaf condition in the screener's filter tree
   with its operator, threshold, the instrument's actual value, and its
   outcome — none omitted.
2. The explanation preserves the filter tree's `AND`/`OR`/`NOT` structure
   with each group's resolved outcome, to arbitrary nesting depth.
3. Each ranking field's raw value, normalized value, weight, and
   contribution to the final score is returned, together with the
   instrument's rank in the run.
4. An instrument the run evaluated but rejected receives a full
   explanation, with its failing conditions identified and a statement
   that it is not among the run's results.
5. An instrument that was outside the run's universe produces an explicit
   error stating it was not evaluated in that run — never an empty or
   partially fabricated explanation.
6. A condition whose input datum was unavailable for that instrument is
   reported as indeterminate with its reason, distinct from a fail.
7. **No screener is executed.** A test using a run store whose execution
   path fails the test if reached demonstrates that an explanation read
   never reaches it — for a passing instrument, a rejected instrument, and
   an expired run.
8. An unknown or expired `run_id` produces an explicit error naming the
   `run_id` and stating the screener must be run again.
9. The explanation names the pinned `run_id` and screener revision it was
   derived from, and carries the same provenance a results page carries.
10. The use case reads only — it makes no workspace mutation and returns
    no mutation envelope.
11. An explanation is bounded: a filter tree or ranking configuration
    large enough to exceed the response bound is truncated with an
    explicit marker naming what was omitted, rather than silently dropped
    or returned unbounded.

## Design References

- `docs/design/results-and-explain/spec.md` — "Explain a result"
  scenarios in full.
- `docs/plan/EPIC-1010/T-1010-3-explanation-domain-model.md` — the
  explanation model this assembles.
- `docs/plan/EPIC-1010/T-1010-2-results-page-and-pinned-run-contract.md` —
  the read contract and provenance record this consumes.

## Technical Considerations

- Whether EPIC-1009 stores per-instrument condition evaluations with the
  run, or only the final verdict, determines whether this use case reads
  them or must recompute them from the run's captured inputs. Recomputing
  from the run's own captured data is acceptable; re-running the screener
  is not. Confirm against EPIC-1009's run contract before implementing and
  record the answer in the epic's open questions if it differs from the
  assumption.
- AC7's test is the guarantee, not the comment — it must fail if the
  implementation falls back to a rerun.

## Out of Scope

- Producing evaluations during a run (EPIC-1009).
- Rendering the explanation (T-1010-7).
- Tool registration (T-1010-8).

## Solution Approach

### Part A — the approved EPIC-1009 gap fix (rejected candidates)

**Problem restated.** `engine.ts`'s `evaluateUniverse` evaluated every
universe instrument but only kept the per-instrument `TreeEvalResult`
(carrying `nodeEvaluations`, the thing an explanation needs) for instruments
that passed. `run.ts`'s `ScreenerRun` had no field for a non-returned
instrument's evaluation at all. `ScreenerMarketData` is a live port, so
re-invoking it after the fact to "explain" a rejected candidate would read
data that can disagree with what the pinned run actually saw — exactly the
silent-rerun-with-different-numbers spec.md's "results are never silently
recomputed" forbids. There is no honest way to explain a rejected candidate
without retaining what the run already computed.

**A third case, found while designing the ranking explanation (AC3).**
`ScreenerRun.matches` only stores the *returned* top-N matches (after the
ranking limit slices `ranking.ranked`), not the full matched set. But
`engine/ranking.ts` normalizes every ranking field *against the full matched
set*, not the returned slice. So even a **returned** instrument's ranking
explanation cannot be honestly recomputed from `run.matches` alone whenever
`matchedCount > returnedCount` (the common case — see the existing
`engine.test.ts` fixture, which already has `matchedCount: 3`,
`returnedCount: 2`). Recomputing normalization over only the returned subset
would silently disagree with the run's own `compositeScore`, which
`explanation.ts`'s `makeResultExplanation` already asserts consistency on
(AC7 of T-1010-3) — so an inaccurate peer set would make legitimate explain
calls throw. This is not scope creep; it is required for AC3 and AC7 (of
T-1010-3) to both hold simultaneously for any screener whose matched set
exceeds its ranking limit.

**The fix — one additive map, done at every layer:**

- `engine/tree.ts`: `walk()` already computes `result.dataUnavailable` per
  leaf (from `conditionEvaluation.shared.ts`'s `ConditionEvalOutcome`) but
  discarded it before storing the leaf's `FilterNodeEvaluation`. Added
  `dataUnavailable: result.dataUnavailable` to the leaf's stored record —
  restoring information EPIC-1009 already computes and only needs to stop
  dropping. This directly satisfies AC6 (indeterminate vs. fail): before
  this, `value === null` was ambiguous between "input missing" and "a
  genuine, available fail with no scalar value" (e.g. `evaluatePattern`'s
  "pattern not detected"); the flag makes the two structurally
  distinguishable, matching T-1010-3's own investigation note.
- `run.ts`: `FilterNodeEvaluation` gained `dataUnavailable?: boolean`
  (optional, so every existing hand-built fixture/test that omits it still
  type-checks and behaves as `false`/not-unavailable, matching the
  `unit?`/`detail?` convention already on this interface). `ScreenerRun`
  gained `rejectedEvaluations: Record<string, RejectedCandidate>`, keyed by
  `instrumentId`, where:
  ```ts
  interface RejectedCandidate {
    instrumentId: string;
    nodeEvaluations: Record<ResourceId, FilterNodeEvaluation>;
    // Only present for an instrument that passed the filter tree (entered
    // ranking) but was not among the returned top-N — absent for a
    // genuinely-failed instrument, which was never ranked.
    rankingValues?: Record<string, number | null>;
  }
  ```
  Despite the name (kept for continuity with the ticket's own working
  vocabulary), this bucket holds **every evaluated instrument not present in
  `matches`** — both instruments that failed the filter tree and instruments
  that passed it but were truncated by the ranking limit. Both need their
  `nodeEvaluations` to be explainable (AC4); the truncated-but-matched case
  additionally needs `rankingValues` so a *returned* instrument's peer
  normalization can be reconstructed exactly (see above). `makeScreenerRun`
  gained one new invariant: no `instrumentId` may appear in both `matches`
  and `rejectedEvaluations` (a match and a rejection are mutually exclusive
  by construction; this catches a hand-assembled or deserialized run that
  violates it). `toWireScreenerRun` now serializes `rejected_evaluations`
  (per the ticket's explicit instruction), reusing the existing
  `toWireFilterNodeEvaluation` helper (now also emitting `data_unavailable`
  when true) plus a small `ranking_values` passthrough per candidate.
- `engine/engine.ts`: `evaluateUniverse` keeps two maps now: `matched` (only
  passed instruments — unchanged, still what `applyRanking` reads) and a new
  `allEvaluations` (every universe instrument, matched or not — the
  superset). After ranking and slicing to the returned set, `execute()`
  builds `rejectedEvaluations` as `allEvaluations` minus the instruments that
  ended up in `matches`, attaching each entry's `rankingValues` from
  `ranking.ranked` (the full, unsliced ranked list) when present. The
  function's doc comment is rewritten to explain this — no longer "kept only
  for matches, bounded by the matched-set size" but "kept for the whole
  universe, because a rejected candidate and a truncated-but-matched
  candidate both need to be explainable from the pinned run alone, and a
  returned candidate's ranking normalization needs the full matched-set
  peer distribution."

**Universe membership vs. rejection (AC5).** `resolveEngineUniverse`
(`universe.ts`) resolves the instrument ID list `evaluateUniverse` then
iterates; an instrument never appearing in that list never gets a
`TreeEvalResult` at all, so it can never land in `matched`,
`allEvaluations`, or (downstream) `matches`/`rejectedEvaluations`. This is
exactly the structural distinction `explain_result` needs: instrument in
(`matches` ∪ `rejectedEvaluations`) → evaluated (AC4 territory); instrument
in neither → never evaluated (AC5 territory, an explicit error).

**A second, necessary extension beyond the pre-approved gap: pinning the
filter tree and ranking spec on the run itself.** `ConditionExplanation`
needs each leaf's full typed `Condition` (operator, threshold) and
`GroupExplanation` needs the tree's `AND`/`OR`/`NOT` shape (AC1, AC2) —
neither is recoverable from `FilterNodeEvaluation` alone (it carries a
node's outcome, not its definition). The only place either currently lives
is `ScreenerDefinition.filterTree`/`.ranking`, read via `state.ts`'s
`readScreener` — but that reads the workspace's *current* screener, which a
later edit can have moved past the run's pinned revision entirely (run.ts's
own comment: "later edits to the screener never change what an
already-minted run reports"). `run_screener`'s tool wiring
(`runScreener.ts`) already has to solve an adjacent problem —
`resolveScreenerRevision` walks `WorkspaceRepository.listRevisions`/
`getRevision` to find a specific past screener revision — but that depends
on the *workspace's* revision retention, which is a separate policy from
`RunRetentionPolicy` (`ports.ts`). A pinned run could still be present under
`RunRetentionPolicy` while its screener's revision snapshot has since been
evicted from workspace history, making it explainable-in-principle but
not-actually-explainable — a needless, avoidable coupling between two
unrelated retention policies. So `ScreenerRun` gained two more additive
fields, populated directly from `input.definition` in `engine.ts`'s
`execute()` (data it already has in hand, no new read):
```ts
filterTree: FilterNode;
rankingSpec: RankingSpec | null;
```
These are **not** added to `toWireScreenerRun`'s output — `run_screener`'s
caller already supplied this exact `ScreenerDefinition` as input, so
echoing the whole filter tree back in every `run_screener` response would
duplicate data the caller already has for no consumer's benefit. They exist
purely for `explain_result` (T-1010-5) to read off the in-memory
`ScreenerRun` object returned by `PinnedRunStore.getRun`, never serialized
independently of `toWireResultExplanation`'s own shaping.

**Storage-growth estimate (the number the project owner asked for).**
Before this change, a run's persisted per-instrument evaluation footprint
was bounded by `returnedCount` — `engine/ranking.ts`'s
`DEFAULT_RANKING_LIMIT` is **100** — regardless of universe or matched-set
size. After this change, it is bounded by `universeCount`, which
`screenerValidation.ts`'s `DEFAULT_ASSUMED_UNIVERSE_SIZE` documents as the
codebase's own working assumption for a typical unresolved/full universe:
**8000** instruments (a plausible full listed-equity universe size). Using
these two existing constants as the "typical" comparison the project owner
asked for: **8000 / 100 = 80×** more per-run stored node-evaluation records
in the worst case (a highly selective screener over a full-size universe,
where previously only the top 100 of possibly many matches were retained at
all, and now every non-returned universe instrument's evaluation is kept
too). A less selective screener narrows the gap somewhat (more of the
universe ends up in `matches` rather than `rejectedEvaluations`), but the
asymptotic bound is now `O(universeCount)` per run instead of
`O(returnedCount)` per run — a qualitative change, not just a constant
factor. `RunRetentionPolicy` (`ports.ts`) is already pluggable, and
`keepAllRuns` — retain every run for the workspace session — is the current
default (`runStore.ts`); with this change, that default retains up to ~80×
more per-instrument data per run than before, for every run kept. If a
workspace runs many screeners over full-size universes in one session, this
is a real, not negligible, memory increase, and the eviction policy may need
revisiting with this multiplier in mind. Tuning `RunRetentionPolicy` itself
is out of scope for this ticket.

### Part B — `explain_result` use case

**Dependencies.** Only `PinnedRunStore` (`screener/ports.ts`) — no
`ScreenerEvaluationPort`, no `ScreenerMarketData`, no import from
`screener/engine/*` anywhere in `src/lib/results/application/explainResult.ts`
or anything it imports. This makes AC7 structurally true (there is no
`execute` reachable through this dependency at all, mirroring
`resultsReader.ts`'s own comment on this), and the AC7 test additionally
proves it behaviorally via `testSupport.ts`'s `createSpyPinnedRunStore`,
asserting `putRunCalls === 0` after every explain call (the store's only
mutating method — "the run store whose execution path fails the test if
reached" is realized as an assertion on the one write path that would prove
a rerun happened, since `PinnedRunStore` has no `execute` member to call in
the first place).

**Outcome type.**
```ts
type ExplainResultOutcome = ResultExplanation | RunNotAvailable | InstrumentNotEvaluated;
```
`RunNotAvailable` (reused verbatim from `screener/ports.ts`) covers AC8; its
message is extended with an explicit "run the screener again" sentence so
the AC8 wording is satisfied without inventing a parallel error shape.
`InstrumentNotEvaluated` is new (AC5): `{ available: false; runId;
instrumentId; reason: 'not_in_universe'; message }`, returned when
`instrumentId` is present in neither `run.matches` nor
`run.rejectedEvaluations`.

**Assembly (pushed into `src/lib/results/domain/explanationAssembly.ts`,
pure, no I/O, so the use case itself stays under the 50-line guidance):**
- `assembleFilterTree(node: FilterNode, evaluations, ancestorEffectivelyEnabled)`
  walks the *definition's* `FilterNode` tree (not the evaluation map) so
  every node — including a disabled one, and every leaf, per AC1's "none
  omitted" — appears in the output. A node's `enabled` in the explanation is
  its own `FilterNode.enabled` **AND** every ancestor's, computed during the
  walk: a leaf nested inside a disabled group was never evaluated by
  `tree.ts`'s `walk()` either (it returns immediately for a disabled node
  without recursing), so it has exactly as little to report as a directly-
  disabled leaf, and folding ancestor state into `enabled` keeps
  `explanation.ts`'s own invariant (`outcome`/`actualValue` null iff
  `!enabled`) satisfiable without fabricating an outcome for a node that was
  never actually run. This is stricter than `explanation.ts`'s literal,
  looser-than-documented invariant (which only checks the disabled case, not
  that enabled implies non-null) — the assembler chooses to satisfy the
  *documented* invariant, not just the enforced one.
- A leaf's `ConditionOutcome` comes from its `FilterNodeEvaluation`:
  `dataUnavailable: true` → `indeterminateOutcome(detail ?? '…')` (AC6);
  otherwise `passed ? passOutcome() : failOutcome()`. A leaf with no
  evaluation entry at all despite being effectively enabled (should not
  happen — same pinned run produced both the tree and the evaluations — but
  guarded rather than assumed) reports indeterminate with a reason naming
  the gap, never a fabricated pass/fail.
- A group's outcome is **recomputed** via `explanation.ts`'s own
  `resolveGroupOutcome(op, enabledChildOutcomes)` over the just-assembled
  children — not read off the group's own stored boolean `passed` — because
  `tree.ts`'s boolean `combine()` cannot represent "indeterminate" at all
  and would misreport an indeterminate branch as a hard fail. This is
  exactly the generalization T-1010-3's own doc describes `resolveGroupOutcome`
  as being for.
- `assembleRanking(run, candidate)` (where `candidate` is either a
  `ScreenerMatch` or a `RejectedCandidate`) builds the peer-value set per
  ranking field by scanning **both** `run.matches` and
  `run.rejectedEvaluations` for that field's raw value — reconstructing the
  exact matched-set distribution `engine/ranking.ts` originally normalized
  against — then delegates the actual arithmetic to
  `explanationRanking.ts`'s `buildRankingExplanation`, never re-implementing
  it. Only called for a `'result'`-standing instrument; a rejected standing
  (including the matched-but-truncated case) gets `ranking: null` per
  `explanation.ts`'s own invariant.
- Bounding (AC11) is applied *after* `makeResultExplanation` has already
  validated the fully-assembled explanation (so the AC7-of-T-1010-3
  contribution-sum invariant is checked against the true, untruncated data)
  — a separate pure pass in `explanationBound.ts` that never re-invokes
  `makeResultExplanation`. `boundFilterTree(tree, maxNodes = 500)` walks the
  tree pre-order with a shared node budget; the first group whose children
  would exceed the budget has its children list cut there and gains an
  optional `truncatedChildCount` (added to `GroupExplanation`, optional, so
  every existing T-1010-3 fixture/test is unaffected). `boundRanking(ranking,
  maxFields = 50)` slices `fields` to the bound and sets an optional
  `truncatedFieldCount` on `RankingExplanation`, **keeping the full,
  untruncated `compositeScore`** — the total score stays correct; only the
  per-field itemization is capped, which is why this step must not re-run
  the sum-consistency check. 500 and 50 are chosen generously relative to
  observed filter trees (a handful to a few dozen nodes in every fixture in
  this codebase) and ranking configs (a handful of fields), so real usage
  never truncates; they exist to give pathological input an explicit,
  bounded response instead of an unbounded one. `explanationWire.ts` gained
  two small additions to serialize `truncated_child_count` /
  `truncated_field_count` when present (via the existing `withoutUndefined`
  convention already used for the leaf-node branch).

**The use case itself** (`explainResult.ts`, ≤50 lines): look up the run
(AC8 on miss); check `instrumentId` membership in `matches` vs.
`rejectedEvaluations` vs. neither (AC5 on neither); build `standing` and
`ranking` from whichever bucket matched; call `assembleFilterTree` off
`run.filterTree`; call `makeResultExplanation`; call the two bound passes;
return. No Clock, no market-data dependency, no mutation envelope (AC10).

### Tests

- `screener/engine/tree.test.ts` (existing file if present, else inline in
  `engine.test.ts`): a leaf whose field is unavailable now carries
  `dataUnavailable: true` on its stored `FilterNodeEvaluation`, distinct
  from a pattern-style "genuine fail with null value".
- `screener/engine/engine.test.ts`: extends the existing fixture
  (`matchedCount: 3`, `returnedCount: 2`) to assert `rejectedEvaluations`
  contains exactly the 3 non-returned universe instruments (I2, I4, I5 —
  two genuine filter-tree failures and nothing else, since I3 the
  truncated-but-matched instrument is also expected here per the unified
  design — see below), that I5's entry marks `filter_l1` as
  `dataUnavailable: true`, and that `filterTree`/`rankingSpec` on the run
  equal the definition's own.
- `screener/run.test.ts`: `makeScreenerRun` throws when an instrument
  appears in both `matches` and `rejectedEvaluations`; `toWireScreenerRun`
  emits `rejected_evaluations` keyed by instrument id.
- `results/domain/explanationAssembly.test.ts`: disabled-leaf and disabled-
  group (with nested enabled-looking children) produce `enabled: false`
  throughout the disabled subtree; an indeterminate leaf resolves an
  enclosing AND/OR to indeterminate per `resolveGroupOutcome`'s truth table;
  a returned instrument's recomputed `compositeScore` matches
  `match.compositeScore` exactly for a fixture where `matchedCount >
  returnedCount` (this is the test that would fail first if the peer-value
  reconstruction were wrong).
- `results/domain/explanationBound.test.ts`: a synthetic tree/ranking config
  exceeding the bound is truncated with the marker set and a non-truncated
  one is returned unchanged (no marker field present at all, not `0`).
- `results/application/explainResult.test.ts` (AC-driven, mutation-checked):
  a passing (returned) instrument's full explanation; a rejected
  (filter-tree-failed) instrument's explanation with `standing: rejected`
  and no ranking; an outside-universe instrument's `InstrumentNotEvaluated`;
  an unknown and an evicted `run_id`'s `RunNotAvailable` (message names the
  run_id and says to run the screener again); AC7's no-rerun test using
  `createSpyPinnedRunStore`, asserting `putRunCalls === 0` across the
  passing/rejected/expired cases in one test.
