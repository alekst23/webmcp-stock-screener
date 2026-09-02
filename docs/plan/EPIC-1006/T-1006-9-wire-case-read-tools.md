# T-1006-9: Wire-case the three read-only tools

**Epic:** EPIC-1006
**Status:** Open

## Goal

`docs/design/workspace-revisions/technical.md`'s "Casing" section states the
agent-facing JSON is snake_case and that "nothing else in the codebase writes
snake_case" besides the one mutation-envelope serializer. `get_app_context`,
`get_canvas_state`, and `get_change_history` (`src/lib/workbench/tools/index.ts`)
violate that: they return raw camelCase objects (`activeWorkspaceId`,
`hasUnsavedChanges`, `changeId`, `diffSummary`, `affectedIds`, `undoState`, etc.)
with no serializer, while the four mutating tools correctly emit snake_case via
`toWireEnvelope`. Sibling epics (T-1007 onward) are meant to follow this epic's
pattern; three of the seven tools already break it.

Add small serializers (e.g. `toWireContext`, `toWireCanvasState`,
`toWireChangeRecord`) alongside `toWireEnvelope` in `domain/mutation.ts` (or a
sibling module), and route the three read tools through them.

## Acceptance criteria

- `get_app_context`, `get_canvas_state`, and `get_change_history` return
  snake_case field names, consistent with the four mutating tools.
- `technical.md`'s "Casing" section either stays accurate as written, or is
  updated to describe the actual serializer(s) used.
- Existing tests updated to assert snake_case field names.
