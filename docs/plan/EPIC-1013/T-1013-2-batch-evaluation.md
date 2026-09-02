# T-1013-2: Non-mutating batch evaluation over the operation registry

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Done
**Depends on**: T-1013-1
**Blocks**: T-1013-5

## Description

The heart of the epic: fold a proposed batch of typed operations over an
immutable copy of the workspace state using the handlers registered in
EPIC-1006's operation registry, producing a candidate next state plus
per-operation outcomes — and provably changing nothing live. This single
evaluation path is what both preview and apply use, which is what makes
the preview honest.

## User Story

As the safety layer,
I want to compute what a batch of operations would do without doing it,
so that a preview can report the real outcome and an apply can commit
exactly that outcome rather than recomputing it.

## Acceptance Criteria

1. Given a workspace state, a revision, and a batch, evaluation returns a
   candidate next state, the affected stable IDs, per-operation warnings,
   and any validation failures.
2. Operations are evaluated in the order given, and each sees the effects
   of the ones before it.
3. Operation handlers are resolved by kind from the registry at evaluation
   time; the evaluator contains no list, switch, or branch specific to any
   particular operation kind.
4. An operation kind absent from the registry produces a validation
   failure naming its position and kind, and evaluation continues so that
   later independent failures are also reported.
5. An operation whose arguments its registered validator rejects produces
   a validation failure carrying the validator's reason.
6. When any failure is present, the result is marked not applicable and
   carries no candidate state a caller could commit.
7. The live workspace state and revision are identical before and after
   evaluation, for every input including batches that fail — verified by
   deep comparison, not by inspection.
8. An empty batch is rejected as invalid input.
9. A batch whose operations are all no-ops evaluates successfully with an
   empty set of affected IDs rather than failing.
10. Evaluation performs no I/O, reads no clock, and generates no IDs.
11. A test registers an operation kind that the evaluation code does not
    reference and drives it through evaluation successfully.

## Implementation Plan

### Module

New file `src/lib/workbench/domain/batchEvaluation.ts`, exporting:

- `interface BatchEvaluation` — `{ candidate, outcomes, failures, warnings,
  affectedIds, fragments }`, where `candidate` is `WorkspaceDocument | null`
  and is `null` whenever `failures` is non-empty (AC6), so a caller holding
  a `BatchEvaluation` for an inapplicable batch has literally nothing it
  could commit.
- `function evaluateBatch(batch, document, deps): BatchEvaluation` with
  `deps: { registry: OperationRegistry; ids: IdSequencer }`.

`OperationRegistry` is a **type-only** import from
`../application/operationRegistry`; no value crosses the layer boundary, so
the domain-never-imports-application rule holds.

This is a new, independent evaluation path. EPIC-1006's `foldForPreview`
and `foldApply` stay exactly as they are; nothing in
`operationRegistry.ts` is touched.

### The fold

1. Empty batch → `throw SafetyError.invalidInput(...)` before any work
   (AC8). An empty batch is a caller mistake, not an outcome to report.
2. Walk the batch left to right, carrying a `current` document, so each
   operation validates and applies against the state its predecessors
   produced (AC2).
3. Per operation, resolve the handler with `registry.get(op.kind)` — the
   only dispatch mechanism in the module. There is no list, map, switch or
   conditional naming any particular kind (AC3, AC11).
4. Three failure paths — unknown kind, non-empty `validate()` issues, and
   any exception from `validate` / `describe` / `apply` — each produce an
   `OperationFailure` carrying `index` and `kind`, and the fold **continues**
   from the last known-good document so later independent failures are
   reported too (AC4, AC5).
5. On success, `draft.affectedIds` accumulate into a deduplicated,
   first-appearance-ordered list; `draft.warnings` become per-operation
   `OperationWarning`s; `draft.diffSummary` becomes the operation's
   fragment and `def.describe(...)` the outcome's `describe`.
6. `candidate = failures.length === 0 ? current : null`.

### Non-mutation strategy: clone per operation

Project decision (2026-09-01): registry handlers are **not** guaranteed
pure — they may have side effects and may mutate the document they are
handed. So the caller's document is never handed to a handler at all.
Each operation receives its own `structuredClone` of the current state:

- The caller's live document and revision are untouched for every input,
  including batches that fail (AC7) — verified by deep comparison in the
  tests, including against a deliberately impure handler.
- A handler that mutates its input and *then* throws cannot corrupt the
  last-known-good document the fold continues from, because what it
  mutated was a private copy.

This is technical.md's explicit clone fallback, promoted to the mandatory
path. The `WHY` is recorded in a comment in the module.

### On AC10 ("generates no IDs")

`evaluateBatch` itself never calls `ids.next()`. It accepts an
`IdSequencer` only because EPIC-1006's
`OperationDefinition.apply(input, doc, ids)` requires one to be threaded
through to handlers. That distinction matters: IDs a handler mints during
preview are exactly the IDs apply commits, because apply commits the
stored candidate rather than re-folding the batch. That is what makes the
honesty guarantee structural.

### Tests

`src/lib/workbench/domain/batchEvaluation.test.ts`, one or more cases per
AC. Every test builds its own registry via `createOperationRegistry()`
(never the shared singleton, which would make tests order-dependent);
fakes record calls in their own closures rather than in a shared map keyed
by kind name. Notable cases: deep before/after comparison across valid,
unknown-kind, validator-rejecting, throwing-handler and impure-handler
batches; a novel kind registered inside the test whose name appears
nowhere in `batchEvaluation.ts`; two independently bad operations both
reported; a second operation that reads what the first produced.

## Design References

- `docs/design/safety-preview-apply/technical.md` — "The central decision:
  one evaluation path" (steps 1-3) and the purity requirement on handlers
- `docs/design/safety-preview-apply/spec.md` — "Preview a proposed batch"
  and "Report validation problems without mutating" scenario tables
- `docs/plan/EPIC-1013/_epic.md` — "What this epic needs from EPIC-1006"

## Technical Considerations

The non-mutation guarantee depends on EPIC-1006's handlers being pure
functions over an immutable state value. If they are not, fold over a
structural clone instead and raise the purity gap with EPIC-1006 — a
clone-based fallback makes the guarantee depend on clone completeness,
which is weaker and should be a known compromise rather than a silent one.

## Out of Scope

Turning the candidate state into a diff (T-1013-3), storing the result
(T-1013-4), and committing it (T-1013-5).
