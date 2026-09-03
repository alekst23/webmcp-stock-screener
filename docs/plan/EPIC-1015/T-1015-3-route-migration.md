# T-1015-3: Migrate routes onto the new panel/workspace model

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Status**: Open
**Depends on**: T-1015-2
**Blocks**: T-1015-5

## Description

The app's routes still render the legacy workspace model — a store of
studies, setups, instance sets, panels and a focus state, drawn by the
legacy grid and chart components. The new surface introduces its own
panel and workspace model with stable IDs and revisions. This ticket
moves every route onto the new model, so that afterwards nothing in
`src/routes/` reads or writes legacy state.

This is the step that makes deletion possible. It changes what renders;
it does not delete the legacy modules — that is T-1015-5 and T-1015-6.

## User Story

As a person opening the app after cutover,
I want the page I already know to work on the new surface,
so that the cutover is a change of engine, not a loss of the product.

## Acceptance Criteria

1. The main route renders panels, layout, and workspace state from the
   new model, and reads no legacy workspace state.
2. The WebMCP status header continues to show the defined tool count,
   the currently-available tool count, and the bridge connection state,
   now reflecting the new tool surface.
3. The activity/action log continues to show actions with human-vs-agent
   attribution, unless T-1015-2 recorded it as a deliberate drop.
4. Every capability T-1015-2 marked as surviving and UI-observable is
   reachable from the migrated routes.
5. The throwaway spike route is removed, and no route links to it.
6. The legacy manual tool harness route is either migrated to drive the
   new tool surface or removed; whichever is chosen is recorded, and
   no route is left half-migrated.
7. A production build succeeds and the app loads with no console errors
   on first paint.
8. No route imports the legacy tool builder, legacy engine client, or
   legacy workspace store.

## Design References

- `docs/plan/EPIC-1015/` — T-1015-1's inventory (which components are
  keep/absorb/retire) and T-1015-2's parity matrix (which capabilities
  must still be reachable).
- `docs/design/pattern-research-workbench/technical.md` — the "Page
  layout" and status-header sections describe the current page
  composition, including the deliberate placement of the activity log
  and snapshot picker, which should not be regressed by accident.
- The design docs of whichever sibling epic owns the new panel/workspace
  model — the target contracts.

## Technical Considerations

The status header's plumbing is being kept, not rewritten: the bridge
state machine and the status formatters are transport-layer modules that
survive the cutover. What changes is the tool list they are fed. Expect
to re-point rather than reimplement.

Chart rendering math (geometry, axis ticks, nearest-bar hit testing,
range slicing) is pure and was marked **absorb** in the inventory. Move
it rather than rewriting it, and carry its tests across — those are the
only tests in the legacy frontend that cover real computation rather
than store plumbing.

The project has no Svelte component-render harness, which is an
established convention here rather than a gap. UI-observable acceptance
criteria are verified through a browser check at ticket close, and
pure logic that moves should keep unit coverage.

## Solution Approach

**Implements**: the "Route migration" scenarios in spec.md (happy path,
status header, surviving capability, throwaway scaffolding).

**Approach**: frontend-only, proceeding under the epic's cleared launch
gate — T-1015-2's original NO-GO verdict was superseded by an explicit
user decision on 2026-09-03; six structural gaps were accepted as
deliberate drops (temporal sequencing, `measure`/`splitInstances`,
instance focus, progressive tool availability, the manual harness route),
and the remainder became new ticket scope (T-1015-9, T-1015-10, T-1015-11)
that this ticket does not need to close. Per the parity matrix's
"reachability gap" list, several capabilities exist as real, merged, tested
code gated behind a build-time flag with no route calling them; making
"surviving capability... reachable from the UI" (AC4) true requires both
(a) routing the main page onto the new panel/workspace composition root
(the same one EPIC-0020 wired for `/workbench`, reusing `registerPanelTools()`
rather than building a second composition), and (b) flipping the flag for
each tool group the parity check confirmed as surviving. `SCREENER_TOOLS_
ENABLED` and `WORKBENCH_TOOLS_ENABLED` are already `true` as of this design
pass; `CHART_TOOLS_ENABLED`, `SIMILARITY_TOOLS_ENABLED`, and
`FOLLOWUP_AUTHORING_TOOLS_ENABLED` are still `false` and, per the parity
matrix, correspond to accepted-surviving capabilities — re-verify each
flag's current value at implementation time rather than trusting this
list, since the codebase has moved since the parity check was written.
`BACKTEST_TOOLS_ENABLED`, `ALERT_TOOLS_ENABLED`, and `WATCHLIST_TOOLS_
ENABLED` stay off unless a sibling epic needs them for a reason
independent of this cutover — `measure`/split (backtest) was an accepted
drop. Chart-math in `visualization.ts` is not ported here — T-1015-1 found
it already reimplemented independently in `workbench/chart/components/
chartScales.ts`; nothing to move. `src/routes/spike/` is deleted and
de-linked (AC5). `src/routes/dev/+page.svelte` has no new-surface
replacement per the parity matrix's confirmed drop, so it is removed
outright rather than migrated (AC6) — executing an already-accepted drop,
not a new decision. The full rebuilt workspace-status header and the new
shared shell are T-1015-9's scope; this ticket only needs the migrated
route to not regress what already renders (AC2), re-pointing the still-
available `status.ts`/`session.ts` formatters at the new tool list as an
interim measure.

**Contracts to introduce**: none new — this ticket wires together
contracts the sibling epics already defined; it does not introduce any.

**Config vars introduced**: none — this ticket flips existing
`*_TOOLS_ENABLED` module constants, it does not add environment variables.

**References**: `docs/plan/EPIC-1015/retirement-inventory.md`,
`capability-parity-matrix.md`, `docs/design/pattern-research-workbench/
technical.md` ("Page layout", status-header sections), the design docs of
whichever sibling epic owns the panel/workspace model.

## Out of Scope

Deleting the legacy tool surface (T-1015-5) or the legacy workspace
model and components (T-1015-6). Backend changes (T-1015-4). Doc
updates (T-1015-7).
