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
