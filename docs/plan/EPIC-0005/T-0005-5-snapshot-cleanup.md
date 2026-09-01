# T-0005-5: Minor cleanup — dedupe empty-workspace literal, shared test fake, unused export

**Epic:** EPIC-0005
**Status:** Open

## Goal

Epic review of EPIC-0005 found three small, non-blocking cleanup items:

1. `snapshotGuard.ts` redefines its own empty-workspace literal instead of
   importing one from `store.ts` (which only exports `normalizeWorkspace`,
   not the underlying empty-state shape). Two independent literals of the
   same shape now exist; a future `WorkspaceState` field addition could
   silently desync them.
2. `snapshots.test.ts` hand-rolls its own `memoryStorage()` fake, identical
   to the one already exported from `testSupport.ts` and used by
   `store.test.ts` — should import the shared one instead.
3. `SnapshotRecord` is exported from `snapshots.ts` but has no non-test,
   non-declaring call site outside the module itself.

## Acceptance criteria

- `store.ts` exports its empty-workspace constructor/literal (or an
  equivalent), and `snapshotGuard.ts` imports and reuses it instead of
  redefining it.
- `snapshots.test.ts` imports `memoryStorage` from `./testSupport` instead
  of defining its own copy.
- `SnapshotRecord` is either scoped module-private (not exported) or its
  intended external consumer is identified and used.
