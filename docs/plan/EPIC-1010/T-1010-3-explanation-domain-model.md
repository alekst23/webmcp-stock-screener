# T-1010-3: Filter explanation and ranking contribution domain model

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Done
**Depends on**: —
**Blocks**: T-1010-5

## Description

Define the typed model that makes a screener's verdict auditable for one
instrument: an evaluation record for every condition in the filter tree —
its threshold, the instrument's actual value, and its outcome — mirroring
the tree's `AND`/`OR`/`NOT` structure, plus a breakdown of how each
ranking field contributed to the instrument's score. Pure domain logic
with no I/O.

## User Story

As a researcher asking "why did the screener pick this one, and why not
that one?",
I want every filter's actual value and pass/fail state and every ranking
field's contribution,
so that the screener's answer is something I can check rather than
something I have to trust.

## Acceptance Criteria

1. An explanation is addressed by a stable instrument ID and names the
   pinned run and screener revision it was derived from.
2. Every leaf condition in the screener's filter tree appears in the
   explanation with: its stable condition ID, a human-readable
   restatement, its operator, its threshold or comparison operand, the
   instrument's actual value with unit, and an outcome.
3. The explanation preserves the filter tree's structure: `AND`, `OR`, and
   `NOT` groups appear as groups, each with its own resolved outcome, and
   nested groups are represented to arbitrary depth.
4. A condition outcome is one of pass, fail, or indeterminate;
   indeterminate carries a reason (such as a missing input datum) and is
   never conflated with a fail.
5. A group's outcome follows from its children's outcomes under the
   group's operator, and the model defines how an indeterminate child
   resolves at the group level.
6. Disabled conditions appear in the explanation marked as not
   contributing to the outcome, rather than being omitted.
7. Each ranking field appears with its raw value, its normalized value,
   its configured weight and direction, and its contribution to the final
   score; the contributions and the reported final score are consistent
   with each other.
8. The explanation states the instrument's rank within the run and whether
   the instrument is among the run's results or was evaluated and
   rejected.
9. Every value in the explanation carries the same provenance record a
   results page carries.
10. The model is a pure representation with no I/O and no dependency on
    how the evaluation was produced.

## Design References

- `docs/design/results-and-explain/spec.md` — "Explain a result"
  scenarios, including "Failed candidate" and "Unavailable data"; Open
  Questions 5 and 6.
- `docs/reference/tool-spec.md` — the `explain_result` row, the
  `edit_filter_tree` condition types (scalar, range, series comparison,
  temporal, event-relative, pattern, relative, study output) that
  explanations must be able to restate, and the ranking configuration
  described under `set_screener_ranking`.

## Technical Considerations

- The filter tree and ranking configuration are EPIC-1009's types.
  Consume them; do not redefine them. If they are not yet available,
  code against the shape the design doc describes and adapt.
- All eight condition types in the design doc must be representable — a
  temporal condition ("crossed above within the last five bars") needs to
  report which bar it occurred on, not just a scalar comparison.
- Contribution arithmetic being self-consistent (AC7) is worth a
  property-style test, not just an example.

## Out of Scope

- Retrieving an evaluation from a stored run (T-1010-5).
- Rendering the explanation (T-1010-7).
- Producing the evaluation during a run (EPIC-1009).

## Solution Approach

### Investigation findings (EPIC-1009's already-merged shapes)

Read `src/lib/screener/{definition,conditions,run,ranking}.ts` and
`src/lib/screener/engine/{tree,conditionEvaluation,conditionEvaluation.shared,
conditionEvaluation.catalog,ranking,engine}.ts` before designing. Findings that
shape this model:

1. **How "indeterminate" is actually represented.** There is no explicit
   indeterminate state anywhere in the persisted data.
   `conditionEvaluation.shared.ts`'s `ConditionEvalOutcome` has a
   `dataUnavailable: boolean` flag, and `unavailableOutcome(reason)` always
   pairs `dataUnavailable: true` with `passed: false, value: null,
   detail: reason`. But `run.ts`'s `FilterNodeEvaluation` — the type actually
   stored on `ScreenerMatch.nodeEvaluations`, and the only thing T-1010-5 will
   have to read — **drops `dataUnavailable` entirely**; it only keeps
   `{ nodeId, passed, value, unit?, detail? }`. `engine/tree.ts`'s
   `TreeEvalResult.unavailableNodeIds` carries the flag one level up, but
   `engine/engine.ts`'s `evaluateUniverse` folds that into a run-level
   `unavailableNodeCounts` map (used only for run-wide warnings) and never
   attaches it back onto the per-instrument `FilterNodeEvaluation` it stores.
   So indeterminate-vs-fail is not reliably recoverable from `value === null`
   alone: `evaluatePattern` in `conditionEvaluation.catalog.ts` returns a
   **genuine, available fail** with `value: null` when a pattern-detection
   engine reports "not detected" (`outcome(false, null, undefined,
   'Pattern not detected.')`), which is indistinguishable, on
   `FilterNodeEvaluation` alone, from `unavailableOutcome`'s `value: null`.
   This is a genuine EPIC-1009 data gap, not something this ticket can close
   (out of scope: producing the evaluation is EPIC-1009's). This model
   therefore defines `ConditionOutcome` as a real three-state union so an
   assembler *can* express indeterminate distinctly, and documents in-code
   that indeterminate detection from a stored run may need more than
   `FilterNodeEvaluation` alone (e.g. cross-referencing the run's
   `unavailableData`-coded warnings by `nodeIds`) — that heuristic is
   T-1010-5's to build, not mine.
2. **Disabled nodes are skipped, not evaluated.** `engine/tree.ts`'s `walk()`
   returns `true` immediately for `!node.enabled` without recursing or
   recording a `FilterNodeEvaluation` at all. A disabled node therefore has
   no actual value or pass/fail to report — AC6 ("marked as not contributing"
   rather than omitted) is a display requirement on the *tree shape* (the
   filter tree itself, which is always available), not on evaluation data
   that doesn't exist for that node. The model reflects this: a disabled
   node's `outcome` is `null` (never an outcome value), never fabricated.
3. **Rejected instruments currently have no stored node evaluations at all.**
   `engine/engine.ts`'s `evaluateUniverse` only keeps a `TreeEvalResult`
   (with `nodeEvaluations`) for instruments where `result.passed` is true;
   `ScreenerMatch` objects (which carry `nodeEvaluations`) are only built for
   `matchedInstrumentIds`. So today there is no `ScreenerMatch`-shaped record
   for a rejected instrument to build a per-condition explanation from — the
   spec's "Failed candidate" scenario is aspirational against EPIC-1009's
   current shape. This is a T-1010-5 blocker to raise with the epic owner,
   not something this ticket's model can paper over; the model simply does
   not assume node evaluations are always present, and represents standing
   (`result` vs `rejected`) independently of whether per-condition detail is
   available.
4. **`ScreenerMatch.rankingValues` holds the raw per-field value, not
   normalized value or contribution.** Confirmed in `engine/ranking.ts`'s
   `computeComposite`: `rankingValues[field.fieldId] = raw` before any
   normalization. Normalization (`percentileRank`/`zScore`/`minMax`) and the
   direction-adjusted contribution (`directedContribution`, then
   `field.weight * directedContribution(...)`, summed with no base term into
   `compositeScore`) are computed inline in infra (`engine/ranking.ts`,
   explicitly labeled an infra layer file) and never persisted per field.
   AC7 needs raw, normalized, weight, and contribution all reported and
   mutually consistent, so this model owns a pure, duplicated port of that
   same arithmetic (`computeRankingFieldContribution`) rather than importing
   the infra file (domain must not import infra/engine). The formula is
   copied verbatim (same three normalization methods, same
   direction-inversion rule) so a consumer that recomputes from a run's own
   `rankingValues` plus the pinned `RankingSpec` reproduces the run's actual
   `compositeScore`.

### Model shape

Implemented across four files under `src/lib/results/domain/` rather than
one, once the single-file draft passed 600 lines against the project's
400-line module guidance — split by concern, mirroring EPIC-1009's own
`conditionEvaluation.ts` / `.catalog.ts` / `.shared.ts` split:
`explanation.ts` (core shape, outcome resolution, the invariant-enforcing
constructor), `explanationRestatement.ts` (AC2's restatement/operator
helpers), `explanationRanking.ts` (AC7's contribution arithmetic), and
`explanationWire.ts` (snake_case serialization). Shared test fixtures live
in `explanationTestFixtures.ts` (not itself a `*.test.ts` file, so importing
it across the four co-located test files never re-executes another file's
suite).

- `ConditionOutcome = { status: 'pass' } | { status: 'fail' } |
  { status: 'indeterminate'; reason: string }` — a discriminated union so
  "indeterminate" structurally always carries a reason and can never be
  mistaken for `fail` (AC4).
- `ConditionExplanation` (leaf): `nodeId`, `enabled`, the full typed
  `condition: Condition` (already carries every family's operator and
  threshold/operand per EPIC-1009's model — not re-flattened into a parallel
  shape), a derived `operatorLabel: string | null` and `restatement: string`
  from pure helpers, `actualValue: { value; unit: string | null } | null`,
  and `outcome: ConditionOutcome | null`. Invariant: `outcome` and
  `actualValue` are `null` exactly when `enabled` is `false` (AC6) — enforced
  by the smart constructor, not left to convention.
- `GroupExplanation`: `nodeId`, `op: GroupOp`, `enabled`,
  `children: FilterNodeExplanation[]`, `outcome: ConditionOutcome | null`
  (same disabled-null invariant). `FilterNodeExplanation` is the
  `ConditionExplanation | GroupExplanation` union, recursive to arbitrary
  depth (AC3).
- `resolveGroupOutcome(op, childOutcomes)`: pure function implementing
  Kleene strong three-valued logic — AND fails on any fail, else
  indeterminate on any indeterminate, else pass; OR passes on any pass, else
  indeterminate on any indeterminate, else fail; NOT flips pass/fail and
  passes indeterminate through; zero children (all disabled, or a genuinely
  empty group) is vacuously `pass`, matching `engine/tree.ts`'s own
  empty-children rule. This is a strict generalization of `tree.ts`'s
  boolean `combine()`: when no child is indeterminate the two agree exactly;
  they can only diverge on a child the engine currently collapses to `fail`
  in place of "unknown" (finding #1). AC5 is satisfied by this function
  being the documented, single source of truth for a group's resolved
  outcome, over *children's outcomes*, not a copy of the engine's boolean.
- `restateCondition(condition)` and `describeConditionOperator(condition)`:
  one small pure function per condition family (switch on `condition.type`),
  producing an English sentence and a short operator label respectively,
  covering all eight families (scalar, range, series_comparison, temporal,
  event_relative, pattern, relative, study_output). Temporal's restatement
  recurses into its inner condition. Field/catalog IDs are shown verbatim
  (no catalog lookup — this module has no I/O and does not import the
  catalog registry); resolving IDs to display labels is a rendering concern
  (T-1010-7). Temporal's "which bar it occurred on" is carried as an
  optional `occurredBarsAgo?: number` on `ConditionExplanation` for a future
  producer to fill in — `engine/conditionEvaluation.ts`'s `evaluateTemporal`
  does not currently compute or expose that index (only a boolean plus a
  free-text detail string), so this field is deliberately optional and
  undocumented-as-always-populated; noting this gap for T-1010-5/EPIC-1009
  rather than fabricating data.
- `RankingFieldContribution`: `fieldId`, `rawValue: number | null`,
  `normalizedValue: number | null`, `weight`, `direction`,
  `contribution: number | null` (null in lockstep with `rawValue === null`,
  matching `computeComposite`'s "unavailable field contributes nothing"
  rule).
- `computeRankingFieldContribution(raw, peerValues, field, normalization)`:
  pure port of `engine/ranking.ts`'s `normalize`/`directedContribution`
  math, taking the instrument's raw value and the matched set's peer raw
  values (both already resolved elsewhere — no market-data access here).
- `RankingExplanation`: `fields: RankingFieldContribution[]`,
  `normalization`, `compositeScore: number | null`. `null` exactly when the
  screener had no ranking or the instrument was rejected (rejected
  instruments are never ranked at all, per finding #4/`engine/engine.ts`).
- `ResultStanding`: `{ status: 'result'; rank: number } | { status:
  'rejected'; rank: null }` (AC8) — a discriminated union rather than two
  independently-nullable fields, so "rejected but somehow has a rank" is not
  representable.
- `ResultExplanation`: `instrumentId`, `runId`, `screenerId`,
  `screenerRevision: Revision` (AC1), `filterTree: FilterNodeExplanation`
  (root), `ranking: RankingExplanation | null`, `standing: ResultStanding`,
  `provenance: MarketDataProvenance` (AC9 — one record for the whole
  explanation, mirroring `ScreenerRun.provenance`'s single-record-per-run
  design rather than duplicating it per value, since every value in one
  pinned run shares identical provenance by construction).
- `makeResultExplanation(input)`: invariant-enforcing smart constructor
  (mirrors `run.ts`'s `makeScreenerRun` style — this is a cross-epic
  boundary type). Throws (programming-error guard, not a typed validation
  result) when: a node's `enabled`/`outcome` pairing is violated anywhere in
  the tree; `standing.status === 'rejected'` but `ranking !== null`; or a
  non-null `ranking`'s `compositeScore` does not equal the sum of its
  fields' non-null `contribution`s (within float epsilon) — this is AC7's
  self-consistency requirement enforced structurally, not just tested by
  example.
- `toWireResultExplanation(explanation)`: snake_case wire serializer,
  mirroring `run.ts`'s `toWireScreenerRun`/`toWireScreenerMatch` convention
  of keeping serialization in the domain module itself (pure data shaping,
  no I/O) so T-1010-5's use case does not have to invent wire shaping.

### Tests (`src/lib/results/domain/explanation.test.ts`)

- `resolveGroupOutcome`: full truth table for AND/OR/NOT over
  pass/fail/indeterminate combinations, including the empty-children
  vacuous-pass case, and a check that it agrees with plain boolean
  AND/OR/NOT when no child is indeterminate.
- `restateCondition`/`describeConditionOperator`: one assertion per
  condition family (all eight), including temporal's recursion into its
  inner condition.
- `computeRankingFieldContribution`: one example per normalization method,
  plus a property-style test over a synthetic matched set (5+ instruments,
  2+ weighted fields, mixed directions) asserting
  `compositeScore === sum(contributions)` for every instrument — this is
  the AC7 property test, not just a hand-picked example.
- `makeResultExplanation`: mutation-checked invariant tests — each one
  constructed to fail without the corresponding guard (disabled node with a
  non-null outcome throws; rejected standing with non-null ranking throws;
  inconsistent compositeScore throws), verified by first confirming the
  happy path succeeds, then perturbing exactly the field the guard checks.
- Disabled-condition marking (AC6) and indeterminate-vs-fail distinctness
  (AC4) covered directly through the leaf/group shapes above.
- `toWireResultExplanation`: smoke test that every field survives to
  snake_case and optional-absent fields are omitted, not nulled (matching
  `run.ts`'s convention).
