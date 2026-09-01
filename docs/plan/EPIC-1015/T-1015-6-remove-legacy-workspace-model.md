# T-1015-6: Remove the legacy workspace model and components

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Status**: Open
**Depends on**: T-1015-5
**Blocks**: T-1015-7

## Description

The last of the legacy product surface: the workspace store that held
studies, setups, instance sets, panels and focus; the HTTP client that
implemented the legacy engine against the backend; and the Svelte
components that drew all of it. With the routes migrated and the tools
gone, nothing writes to this model any more.

Anything the inventory marked **absorb** — pure chart math, the action
log, snapshot persistence — must already have landed in the new surface
before its source file is deleted here.

## User Story

As a developer reading `src/lib/` after cutover,
I want one workspace model in the codebase,
so that I never have to work out which of two stores a given component
is bound to.

## Acceptance Criteria

1. The legacy workspace store, its persistence, and its human-side
   mutation helpers are removed.
2. The legacy HTTP engine client and its instance-window fetching are
   removed.
3. The legacy Svelte components — workspace view, grid panel, price
   chart, focus chart, chart toolbar, activity feed, snapshot picker —
   are removed, and nothing imports them.
4. Every capability the inventory marked **absorb** exists in the new
   surface before its legacy source file is deleted, verified by a test
   or a browser check rather than by inspection alone.
5. Absorbed pure logic keeps unit-test coverage equivalent to what it
   had in the legacy modules; coverage is not lost in the move.
6. The legacy browser-storage keys are either migrated, deliberately
   abandoned with the decision recorded, or cleaned up — a returning
   user does not see a broken app because of stale stored state.
7. Typecheck, lint, and the full frontend test suite pass, and a
   production build succeeds.
8. No commented-out code, unused imports, unused exports, orphaned test
   helpers, or unreachable branches remain.

## Design References

- `docs/plan/EPIC-1015/` — T-1015-1's inventory, specifically its
  **absorb** entries and their named destinations.
- `docs/design/pattern-research-workbench/spec.md` — the shared
  workspace and collaboration scenarios; the human-side half of focus
  and selection is behavior that lives in the store rather than in any
  tool, and is easy to drop by accident.
- `docs/design/workspace-snapshots/spec.md` — snapshot behavior,
  including the unsaved-changes guard, and its explicit rule that the
  action log is not part of a snapshot.

## Technical Considerations

The legacy store deliberately keeps human-driven and agent-driven halves
of focus state separate, so that a human selecting a grid instance and
an agent zooming to an event cannot clobber each other. If the new model
has one focus field where the old had two, that is a behavioral change
and should be caught here rather than discovered later.

Both the workspace store and the activity store persist to browser
storage under fixed keys and were written to survive corrupted or
foreign data in their slot without crashing on load. The new model
should be at least as tolerant, and stale legacy keys left behind in
real users' browsers are the reason AC6 exists.

Deleting components that snapshots and the activity feed render through
will surface any remaining coupling between the snapshot module and the
legacy state shape. Resolve it by deleting or moving, never by leaving a
shim.

## Out of Scope

Backend changes (T-1015-4). Doc updates (T-1015-7). Live-deploy
verification (T-1015-8). Building new-surface replacements — those
belong to the sibling epics.
