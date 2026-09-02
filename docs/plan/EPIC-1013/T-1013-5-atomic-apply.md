# T-1013-5: Atomic apply with revision, idempotency, and undo

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Done
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

## Implementation Plan

New file `src/lib/workbench/application/safetyUseCases.ts` exports
`SafetyDeps`, `previewWorkspaceChanges`, and `applyPreviewedChanges`. Both
use cases stay orchestration-only (AC12): each is a short function that
calls into small private helpers in the same file, none of which contain
domain logic of their own — they only sequence calls into
`evaluateBatch`, `diffWorkspaces`/`summarizeDiff`, `PreviewStore`,
`RevisionService`/`recordCommit`, and `IdempotencyCache`.

### `previewWorkspaceChanges`

`resolveWorkspace` picks `input.workspaceId ?? repository.getActiveId()`
and throws `SafetyError.invalidInput` both when no id is available and
when the id does not resolve to a stored document. The rest follows the
ticket's five-step recipe verbatim: `evaluateBatch` → `diffWorkspaces`
(only when a candidate exists) → `summarizeDiff` → `buildPreviewResult`
(never a hand-assembled `PreviewResult` literal, so `affectedIds` and
`applicable` stay derived) → `previews.put(...)`. Nothing here calls
`repository.put`, `revisions.commit`, or `history.append` — AC2 is
structural, not merely tested.

### `applyPreviewedChanges` — ordering is the whole point

1. **Idempotency replay first.** `fingerprintRequest('workbench.apply_previewed_changes',
   { previewId })`, then (only when `idempotencyKey` is set)
   `deps.idempotency.lookup(key, fingerprint)`. A hit returns the stored
   envelope and nothing else runs. This has to happen before the preview
   store is consulted: a successful apply calls `previews.markConsumed`,
   so a retry that checked the store first would see `status: 'consumed'`
   and be told "already applied" instead of getting its original result
   back — that's the difference between AC9 (no key, second apply is
   refused) and AC10 (same key, second apply replays).
2. `previews.get(previewId)` mapped to `unknown_preview` / `expired_preview`
   / `already_applied`, then `record.result.applicable === false` mapped
   to `not_applicable` (AC7).
3. Load the live document by `record.candidate.id`; a revision mismatch
   against `record.baseRevision` is `stale_revision` (AC5) — checked
   *before* `expectedRevision`, because by the time both checks can even
   run, `record.baseRevision === current.revision`, so an `expectedRevision`
   that disagrees with `record.baseRevision` disagrees with the current
   revision too (AC6), and a stale preview should be reported as stale
   even when the caller happened to omit `expected_revision`.
4. Commit through `recordCommit` with `mutate: () => draft`, where the
   draft's `document` is `record.candidate` — never a re-fold of the
   batch — `affectedIds`/`diffSummary` copied verbatim from
   `record.result`, and exactly one `inverse` covering the whole batch
   (pre-apply document, same `affectedIds`, a reversal sentence). Always
   pass `expectedRevision: record.baseRevision` so the revision service's
   own compare-and-swap performs the write, and the same
   `operationKind`/`requestInput` used for the top-level fingerprint so
   `RevisionService.commit`'s own idempotency bookkeeping agrees with
   ours.
5. **Rollback guard (AC8).** Clone the pre-apply document before the
   commit. On any throw from the commit step, compare the (possibly
   advanced) stored document against that clone; if they differ, write
   the clone back via `repository.put` before rethrowing.

### Why the rollback test targets the storage write, not a handler

AC8's own wording asks for "a handler that fails at commit time". In this
design that scenario cannot occur: handlers only ever run during
`evaluateBatch`, at preview time. Apply never calls a handler again — it
commits the candidate `evaluateBatch` already computed. That is precisely
the mechanism that makes honesty structural (T-1013-5's central point),
so preserving it means there is no "commit-time handler failure" to
reproduce. A handler that throws during evaluation is a preview-time
failure: it surfaces as an `OperationFailure`, which makes
`record.result.applicable === false`, which makes apply refuse with
`not_applicable` before touching storage at all — that is a real,
tested path (AC7), but it is a reject-early path, not a rollback path.

The actual commit-time failure surface, given this design, is the
storage write inside `RevisionService.recordSuccess`: it calls
`repository.put(nextDoc)` and *then* `repository.putRevision(...)`. If
`putRevision` throws, `put` has already landed — the workspace document
is advanced but no revision snapshot exists for it, which is a genuine
half-applied state with no handler involved. That is the failure this
ticket's rollback test exercises, using a `WorkspaceRepository` fake
whose `putRevision` throws a `StorageWriteError` after `put` succeeds. A
second variant covers `put` itself throwing (nothing lands, so the
rollback guard is a no-op, but the throw must still propagate and no
change-history record or undo token may exist). A third, clearly-labeled
test applies a preview containing a preview-time handler failure to show
the reject-early path is distinct evidence from the rollback path — it
does not, by itself, stand in for AC8.

### Test plan (see ticket's own "Tests" section for the full list)

- AC2: `structuredClone` before/after preview, for a valid batch, an
  invalid batch (validation failure), and a no-op batch.
- AC4 honesty: preview → apply → compare envelope to preview record,
  and `diffWorkspaces(before, after)` on the real repository state to
  `record.result.diff`, across single-op, multi-op, multi-entity and
  no-op batches.
- AC5/AC6/AC7/AC9/AC10 as individually described in the ticket.
- AC8: the two rollback variants plus the labeled reject-early contrast
  test described above.
- AC11: one `undo_token` per applied multi-operation batch, redeemed via
  `undoChange`, workspace contents restored; a failed apply issues none.
- Extensibility: an operation kind registered only inside the test file,
  named nowhere in `safetyUseCases.ts`, driven through preview and apply.

All registries are built fresh per test with `createOperationRegistry()`;
the shared `operationRegistry` singleton is never touched. Fakes are
keyed by object identity, not by name, so a duplicate-write defect can't
hide behind a coincidentally-equal key.
