# T-1015-11: Fix get_canvas_state's panel-state blind spot

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Design**: docs/design/legacy-surface-cutover/
**Status**: Open
**Depends on**: —
**Blocks**: T-1015-12

## Description

A pre-existing gap, not a legacy-parity question: the shared
workspace-read tool's panel-state projection is built against a closed
union of panel kinds fixed when the read model was first defined.
`normalizeWorkspace` silently drops any panel kind outside that union
from its projection, so an agent calling the shared read path cannot see
panels of a kind introduced after the union was closed — a real
correctness gap in the new surface itself, independent of anything the
legacy surface did. Fixing it is a precondition for T-1015-12's new
panel kinds to actually be visible to an agent through the standard
read path, so it's sequenced first.

## User Story

As an agent operating on the app,
I want to see every panel actually present in the workspace when I ask
for its state,
so that "what panels exist" has one honest answer regardless of which
panel kind I'm looking at.

## Acceptance Criteria

1. The panel-state projection consulted by the shared workspace-read
   tool covers every registered panel kind, not a fixed closed set.
2. A panel of a kind introduced after the original union was defined
   (e.g. a kind registered by a later epic) appears in the read tool's
   result.
3. No regression to any panel kind already covered.
4. A test proves the specific regression this fixes: registering a novel
   panel kind and confirming it is visible through the read path, not
   silently dropped.

## Solution Approach

**Implements**: spec.md's "Workspace read parity" scenario.

**Approach**: frontend-only. There are **two** closed unions in the read
path, not one, and both must widen or the fix is incomplete:

1. `src/lib/workbench/domain/workspace.ts`'s `normalizePanel` (called by
   `normalizeWorkspace`, which `workspaceRepository.ts`'s `get()`/`list()`/
   `getRevision()` call on *every* read — including the read right after a
   write, since `put()` stores via `JSON.stringify` and `get()` always
   re-parses and re-normalizes) drops any panel whose `kind` isn't in the
   hardcoded 8-entry `PANEL_KINDS` set.
2. `src/lib/panels/application/panelState.ts`'s `projectPanels`/
   `projectLayout` (called by `writePanelState`, the only path that turns
   the real source of truth — `state.panels` under
   `doc.extensions['panel_system']`, which is itself kind-agnostic — into
   `doc.panels`/`doc.layout`, what `get_canvas_state` actually reads) filter
   through a second, independently-hardcoded `PROJECTABLE_KINDS` set of the
   same 8 kinds.

Widening only #2 is not sufficient: a 9th-kind panel would survive the
projection into `doc.panels`, then get silently dropped again the next
time anything calls `repository.get()` (which `getCanvasState()` in
`workbench/tools/index.ts` does directly). Both must change:

- `workspace.ts`: drop the `PANEL_KINDS.has(kind)` check in
  `normalizePanel`; keep `typeof kind === 'string'` (and non-empty) as the
  only validity requirement. Widen the exported `PanelKind` type from a
  closed string-literal union to `string` — verified its only consumers
  are this file's own `PanelRecord.kind` field and `normalizePanel`'s
  cast, so this is a contained change.
- `panelState.ts`: replace the local `PROJECTABLE_KINDS` Set with a check
  against the already-registered `PanelRegistry` (`registry.has(kind)`),
  which genuinely tracks every registered kind, placeholder or real.
  Thread a `PanelRegistry` parameter through `writePanelState(doc, state,
  registry)` → `projectPanels(panels, registry)` /
  `projectLayout(panels, registry)`. Update the one production call site —
  `panels/application/support.ts`'s `commitPanelChange` — to pass
  `deps.kinds` (already present on `PanelUseCaseDeps`, so no new wiring
  is needed at the composition-root level).

AC4's test should register a novel kind directly against a `PanelRegistry`
instance (no sibling-epic kind needs to exist for real), create a panel of
that kind through `createPanel`, and assert it appears in a `getCanvasState`
call's `panels` array **after** a `repository.get()` round-trip (an
in-memory `Storage` fake is enough to exercise the JSON round-trip that
currently causes the drop) — a test that only exercises `writePanelState`
in isolation would pass even with `workspace.ts` left unfixed, and
therefore would not actually prove the regression is gone.

**Contracts to introduce**: none new — this widens the input two existing
filters accept; no new types or files.

**Config vars introduced**: none.

**References**: `src/lib/workbench/domain/workspace.ts` (`PanelKind`,
`PANEL_KINDS`, `normalizePanel`, `normalizeWorkspace`),
`src/lib/panels/application/panelState.ts` (`PROJECTABLE_KINDS`,
`projectPanels`, `projectLayout`, `writePanelState`),
`src/lib/panels/application/support.ts` (`commitPanelChange`,
`PanelUseCaseDeps.kinds`), `src/lib/workbench/infra/workspaceRepository.ts`
(confirms every read re-normalizes), `src/lib/workbench/tools/index.ts`'s
`getCanvasState` (the actual consumer), `src/lib/panels/registry/
panelKindRegistry.ts` (`PanelRegistry.has`).

## Design References

- `docs/design/legacy-surface-cutover/spec.md` — "Route migration"
  scenario: "Workspace read parity".
- `docs/design/legacy-surface-cutover/technical.md` — "Panel-state read
  model (widened)".
- `docs/plan/EPIC-1015/capability-parity-matrix.md` — item 10, where
  this gap was first surfaced during the audit.

## Out of Scope

Adding the new panel kinds themselves (T-1015-12) — this ticket only
makes the read path see whatever kinds exist, registered or not.
