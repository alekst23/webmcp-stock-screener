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

## Solution Approach

**Implements**: the "Workspace-model removal" scenarios in spec.md (happy
path, absorbed logic, returning user).

**Approach**: frontend-only, gated on T-1015-5, T-1015-9, T-1015-10, and
T-1015-12 per the epic's current dependency graph — the legacy workspace
model (including the legacy shell, `AppShell.svelte`) can only go once
every new-surface replacement it backs has actually landed, not just the
tool surface. Delete `store.ts`, `apiEngine.ts`, and their tests;
`WorkspaceView.svelte`, `GridPanel.svelte`, `PriceChart.svelte`,
`FocusChart.svelte`, `ChartToolbar.svelte`, `ActivityFeed.svelte`,
`SnapshotPicker.svelte`; and `src/lib/shell/AppShell.svelte` (T-1015-1
found no new-surface consumer for it — `/workbench` renders no shell at
all before T-1015-9 builds one). `visualization.ts` is deleted as a
**retire, not absorb** — the inventory found `chartScales.ts` already
reimplements the same technique independently, so there is nothing to
port and no coverage to carry across for that file specifically (AC4/AC5
are satisfied by the pre-existing `chartScales.ts` coverage, verified,
not assumed). `activity.ts` and its test do not delete until T-1015-10's
attributed action-log replacement is live — deleting it first would
silently execute a capability drop the user did not actually accept
(item 6 in the parity matrix became new scope, not a drop). `snapshots.ts`/
`snapshotGuard.ts` delete once `WORKBENCH_TOOLS_ENABLED`-gated
`revisionService.ts` is confirmed live (T-1015-3) — an independently-built
replacement, not code this ticket moves. `apiConfig.ts` and `panelStatus.ts`
need separate treatment despite living in the same directory: `apiConfig.ts`
is **kept** (three live new-surface tool files import
`resolveApiBaseUrl` directly) and must not be deleted; `panelStatus.ts`
and `tickerSearch.ts`/`TickerSearch.svelte` retire, with their loss
already flagged as accepted parity gaps (data-freshness half of the
status header; human-driven ticker search) rather than a new decision
made here. The legacy store's separate human-driven and agent-driven
focus fields are a named risk from Technical Considerations: if the new
model has collapsed them to one field, record that explicitly as a
behavioral change rather than letting it pass silently (AC4 in spirit).
Legacy `localStorage` keys (`workspace/store.ts`'s and `activity.ts`'s)
are migrated, deliberately abandoned with the decision recorded, or
actively cleared on load, so a returning user's stale data cannot break
the new surface's parsing (AC6).

**Contracts to introduce**: none — this ticket only deletes.

**Config vars introduced**: none.

**References**: `docs/plan/EPIC-1015/retirement-inventory.md` §4-5
(absorb/retire entries and their corrections, including the `apiConfig.ts`
"keep" correction), `capability-parity-matrix.md` (which drops became
T-1015-9/10/12 scope vs. accepted drops), `docs/design/pattern-research-
workbench/spec.md`, `docs/design/workspace-snapshots/spec.md`.

## Out of Scope

Backend changes (T-1015-4). Doc updates (T-1015-7). Live-deploy
verification (T-1015-8). Building new-surface replacements — those
belong to the sibling epics.
