# T-1013-5: Atomic apply with revision, idempotency, and undo

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Open
**Depends on**: T-1013-2, T-1013-3, T-1013-4
**Blocks**: T-1013-6

## Description

Compose evaluation, diffing, and the preview store into the two use cases
the epic exists for: previewing a batch, and atomically applying a
previewed batch. This is where the revision check, the idempotency key,
the undo token, and the all-or-nothing commit come together, and where the
honesty and atomicity guarantees become testable end to end.

## User Story

As an agent proposing a batch of workspace changes,
I want a preview that tells me exactly what will happen and an apply that
either does all of it or none of it,
so that I can act on a researcher's workspace without leaving it in a
state neither of us expected.

## Acceptance Criteria

1. Previewing a batch evaluates it, diffs the result, stores the preview,
   and returns the preview ID, the base revision, the diff, the affected
   IDs, the summary, the warnings, and whether it is applicable.
2. Previewing leaves the workspace's contents and revision unchanged, for
   every input including batches that fail validation.
3. Applying a valid preview whose base revision is still current advances
   the workspace by exactly one revision and returns the common mutation
   envelope — `change_id`, `new_revision`, `affected_ids`, `diff_summary`,
   `warnings`, `undo_token`.
4. Honesty: the applied envelope's affected IDs, summary, and diff equal
   what the preview reported, across single-operation, multi-operation,
   multi-entity, and no-op batches.
5. Applying a preview whose base revision no longer matches the live
   workspace fails with a stale-preview error naming both revisions,
   leaving contents and revision untouched.
6. When the caller supplies an `expected_revision` that matches neither
   the preview's base nor the current revision, the call fails with a
   precondition error and nothing is mutated.
7. Applying a preview that carries validation failures fails and mutates
   nothing.
8. Atomicity: if any part of the commit fails, no operation in the batch
   is observable in the workspace and the revision does not advance —
   demonstrated with a handler that fails at commit time, not only at
   validation time.
9. Applying the same preview twice without an idempotency key fails the
   second time as already-applied, with no second mutation.
10. Repeating an apply with the same `idempotency_key` returns the
    original result verbatim, with no second mutation and no second undo
    token.
11. Exactly one undo token is issued per applied batch, and redeeming it
    restores the workspace's pre-apply contents; a failed apply issues no
    token.
12. Each use case stays within the project's orchestration size limits,
    with domain logic pushed down rather than inlined.

## Design References

- `docs/design/safety-preview-apply/spec.md` — all five scenario tables;
  this ticket is where they become executable
- `docs/design/safety-preview-apply/technical.md` — "The central decision:
  one evaluation path" steps 4-5, and "Why not auto-rebase a stale
  preview"
- `docs/plan/EPIC-1013/_epic.md` — "What this epic needs from EPIC-1006"
  (compare-and-swap commit, idempotency store, undo issuance)
- `docs/reference/tool-spec.md` — the exact envelope field names

## Technical Considerations

Apply commits the candidate state the preview already computed; it must
not re-fold the batch, or honesty degrades to a coincidence. Prefer
EPIC-1006's compare-and-swap commit for the revision check and the atomic
swap in one primitive — a read-then-write pair reintroduces the race the
revision check exists to close.

Atomicity tests are only evidence if they exercise a commit-time failure;
a test where the batch is rejected during validation proves the
reject-early path, not rollback.

## Out of Scope

Tool schemas and WebMCP registration (T-1013-6); the `undo_change` tool
itself (EPIC-1014).
