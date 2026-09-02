# T-1006-6: Change history, undo tokens and revision restore

**Epic**: EPIC-1006 (Workspace, Revisions & the Common Tool Contract)
**Design**: docs/design/workspace-revisions/
**Status**: Done
**Depends on**: T-1006-5
**Blocks**: T-1006-8

## Description

A mutation is only safe if it can be reversed and only auditable if it is
recorded. This ticket adds the append-only change log, undo-token issuance
and redemption, and restoring a workspace to an earlier revision. Undo and
restore both go back through the revision service, so reversing a change is
itself a numbered, recorded, undoable change — history grows, it never
rewrites.

## User Story

As a human watching an agent make five changes I did not ask for,
I want to see what each one did and take the last one back,
so that experimenting with the agent is cheap instead of frightening.

## Acceptance Criteria

1. Every applied change is recorded with its change ID, the workspace it
   belongs to, the revision it produced, when it happened, whether a human
   or an agent initiated it, its diff summary, its affected IDs and its
   undo state.
2. The change history for a workspace can be listed newest-first, with an
   optional limit and an optional starting point, and never includes
   another workspace's changes.
3. Redeeming an undo token reverses exactly the change that issued it and
   produces a new, higher revision.
4. The reversal is itself recorded in the history as a change, with its own
   change ID and its own undo token, so undoing an undo redoes the original
   change.
5. Redeeming the same token a second time is refused as already redeemed,
   and the workspace is unchanged.
6. Redeeming an unknown token is refused as unknown, and the workspace is
   unchanged.
7. Redeeming a token whose change is no longer the newest un-redeemed
   change is refused as superseded, with a message directing the caller to
   restore a revision instead, and the workspace is unchanged.
8. A change recorded without an inverse reports itself as not undoable and
   issues no token.
9. Restoring a workspace to an earlier revision makes the workspace's
   contents equal that revision's contents while moving the workspace
   forward to a new, higher revision.
10. A restore is recorded as an ordinary change and can itself be undone;
    no earlier history entry is deleted or altered by it.
11. Restoring to a revision that has no stored snapshot is refused with a
    clear reason, and the workspace is unchanged.
12. The change log is bounded per workspace, and pruning the oldest entries
    never removes an entry whose undo token is still redeemable.

## Design References

- `docs/reference/tool-spec.md` — the `undo_change` Persistence row and the
  `get_change_history` / `restore_workspace_revision` follow-up tools.
- `docs/design/workspace-revisions/spec.md` — the "Backing out" scenarios.
- `docs/design/workspace-revisions/technical.md` — "T-1006-6" section for
  `ChangeRecord`, `ChangeHistory`, `undoChange`, `restoreRevision`.
- `docs/plan/EPIC-1006/_epic.md` — Open Question 3 records why undo is
  restricted to the newest un-undone change.

## Solution Approach

`changeHistory.ts`'s `createChangeHistory()` holds an in-memory
`Map<workspaceId, ChangeRecord[]>` (append-only, newest pushed to the
end; `list` reverses/slices for the newest-first + `limit`/`before`
contract) capped at 200 per workspace via oldest-first pruning that skips
any record whose `undoState === 'available'` (AC12) — since restore/undo
themselves append rather than mutate history, a record's snapshot is
covered by T-1006-4's own 100-per-workspace retention, which the ticket
notes must stay consistent with this 200-record cap (history can reference
more revisions than snapshots retain only for records already fully
redeemed, which need no snapshot).

`undoChange(token, deps)`: `history.findByUndoToken` locates the record;
missing → `UndoTokenError('unknown')`; `undoState !== 'available'` →
`'already_redeemed'`; record is not `history`'s newest entry for that
workspace → `'superseded'` (message names `restore_workspace_revision`).
On success, `deps.revisionService.commit({ mutate: () => storedInverseDraft })`
is called — going through T-1006-5's `commit`, not the repository directly
— then `history.markRedeemed(token)` and `history.append(...)` record the
reversal itself as a new `ChangeRecord` with its own undo token (the
forward draft's inverse, i.e. undoing the undo redoes the original).

`restoreRevision(workspaceId, revision, context, deps)`: loads the target
snapshot via the repository (missing → a clear `OperationValidationError`),
and commits a draft whose `document` is that snapshot's content with
`revision`/`updatedAt` left for `commit` to stamp forward — never copying
the old revision number back (AC9). The inverse draft is "restore back to
the revision that was current before this restore," so restoring is itself
undoable.

**Contracts introduced:** `ChangeRecord`, `ChangeHistory`,
`createChangeHistory`, `undoChange`, `restoreRevision` —
`src/lib/workbench/application/changeHistory.ts`.

## Technical Considerations

- Module: `src/lib/workbench/application/changeHistory.ts`.
- Exported contract surface other epics depend on: `ChangeRecord`,
  `ChangeHistory`, `createChangeHistory`, `undoChange`, `restoreRevision`.
- Undo must apply the stored inverse **through** the revision service's
  commit path, not by writing the repository directly — otherwise the
  reversal skips concurrency checks and does not get a revision.
- The superseded rule is a correctness guard, not a limitation to work
  around: reversing a change that later changes built on would produce a
  state neither party asked for. The error message must name the
  alternative so an agent can recover in one turn.
- Restore is forward-only by design. Implement it as a change whose next
  state is the target snapshot's document with the current revision counter
  continuing — do not copy the old revision number back.
- History records persist alongside revisions in the repository's storage;
  keep the retention interaction with T-1006-4's snapshot pruning
  consistent so a listed change always has a restorable snapshot behind it.

## Out of Scope

The `undo_change`, `get_change_history` and `restore_workspace_revision`
tool wrappers themselves (T-1006-8), and any UI for browsing history.

## Implementation Notes

- Added `recordCommit(deps, input)` to `changeHistory.ts`, exported
  alongside `undoChange`/`restoreRevision`. Neither `_epic.md` nor
  `technical.md` specify who calls `ChangeHistory.append` for an
  *ordinary* mutation, but AC1 requires every applied change to be
  recorded regardless of origin -- `RevisionService.commit` (T-1006-5)
  deliberately doesn't know about `ChangeHistory`. `recordCommit` wraps
  `commit` and appends the resulting `ChangeRecord`, skipping the append
  only when `commit` returned an idempotency replay (detected by mutate()
  never having been invoked). T-1006-7's `applyOperations` and T-1006-8's
  mutating tools call this instead of `revisionService.commit` directly.
- `ChangeRecord` carries one field beyond `technical.md`'s list:
  `inverseDraft?: MutationDraft | null`, the actual draft `undoChange`
  applies to reverse the record -- never serialized to an agent. Its own
  `.inverse` is set to the original forward draft, so undo and redo chain
  indefinitely in both directions without a second stored copy.
- Updated `docs/design/workspace-revisions/technical.md`'s T-1006-6
  section to document `recordCommit` and the `inverseDraft` field.
