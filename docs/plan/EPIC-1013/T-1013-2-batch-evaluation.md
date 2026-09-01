# T-1013-2: Non-mutating batch evaluation over the operation registry

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Open
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
