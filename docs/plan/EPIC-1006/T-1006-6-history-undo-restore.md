# T-1006-6: Change history, undo tokens and revision restore

**Epic**: EPIC-1006 (Workspace, Revisions & the Common Tool Contract)
**Design**: docs/design/workspace-revisions/
**Status**: Open
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

- `.dev/design/tool-spec.md` — the `undo_change` Persistence row and the
  `get_change_history` / `restore_workspace_revision` follow-up tools.
- `docs/design/workspace-revisions/spec.md` — the "Backing out" scenarios.
- `docs/design/workspace-revisions/technical.md` — "T-1006-6" section for
  `ChangeRecord`, `ChangeHistory`, `undoChange`, `restoreRevision`.
- `docs/plan/EPIC-1006/_epic.md` — Open Question 3 records why undo is
  restricted to the newest un-undone change.

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
