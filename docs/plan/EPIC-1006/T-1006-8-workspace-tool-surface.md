# T-1006-8: Workspace and context tool surface

**Epic**: EPIC-1006 (Workspace, Revisions & the Common Tool Contract)
**Design**: docs/design/workspace-revisions/
**Status**: Open
**Depends on**: T-1006-3, T-1006-6, T-1006-7
**Blocks**: —

## Description

The wiring ticket. It exposes the seven Context, Workspace and Persistence
tools from the design doc over the infrastructure the earlier tickets
built, and provides the composition root sibling epics plug into. It is
also the proof that the common contract works end to end: an agent can read
context, make a guarded change, see the envelope, read the history and undo.

## User Story

As an AI agent connected to the workbench,
I want to discover the workspace, create and save one, review what changed
and undo a mistake, all through tools,
so that I can work in the shared session without a human having to click
anything on my behalf.

## Acceptance Criteria

1. Asking for the application context returns the active workspace, the
   selected screener, the focused panel, what the surface is permitted to
   do, the market-data delay, the presentation timezone and the current
   revision.
2. Asking for the workspace returns its panels, layout, links, active
   symbol, screener configuration and whether it has changes not saved
   under a name — every item carrying its stable ID.
3. A workspace can be created blank or from a named template, is given a
   stable ID at revision 1, and becomes the active workspace.
4. The current workspace can be saved under a name, and the name attaches
   to the current revision rather than creating a separate numbering.
5. A change can be undone by presenting the undo token the tool that made
   it returned.
6. The change history can be retrieved for a workspace, limited in size and
   optionally starting before a given revision.
7. A workspace can be restored to an earlier revision through a tool call.
8. Every mutating tool accepts an expected revision and an idempotency key,
   and returns the mutation envelope with the field names the design doc
   specifies.
9. Every failure returns a structured error identifying its kind, rather
   than an unstructured message, and is marked as an error result.
10. Every tool result carrying market data states its provenance.
11. All seven tools are registered with the browser's model context and are
    callable, and the tool count the application reports increases
    accordingly.
12. The shipping 11-tool pattern-research surface remains registered and
    functional, its UI is unchanged, and the application still builds and
    runs.

## Design References

- `.dev/design/tool-spec.md` — the Context, Workspace and Persistence rows
  name and describe each of the seven tools.
- `docs/design/workspace-revisions/spec.md` — the "Reading the situation"
  and "Naming a state worth keeping" scenarios.
- `docs/design/workspace-revisions/technical.md` — "T-1006-8" section:
  `WorkbenchDeps`, `buildWorkbenchTools`, and the tool/input table.
- `src/lib/webmcp/types.ts` — the `ToolSpec` and `ToolResult` contract the
  new tools must satisfy.
- `src/lib/webmcp/register.ts` — the registration path and its
  availability-gating behavior.
- `src/lib/webmcp/status.ts` — how the app reports whether tools are
  actually callable; the new tools must be counted correctly.

## Technical Considerations

- Modules under `src/lib/workbench/tools/`, with `index.ts` exporting
  `buildWorkbenchTools(deps: WorkbenchDeps): ToolSpec[]` — the composition
  root each sibling epic mirrors with its own `build<Area>Tools(deps)`.
- Exported contract surface other epics depend on: `WorkbenchDeps` and
  `buildWorkbenchTools`.
- Tool names and input properties are snake_case, per the design doc;
  everything internal stays camelCase. Read tools return plain JSON,
  mutating tools return the wire envelope.
- Registering these tools alongside the existing 11 is new behavior in
  existing code. Per the project's dead-code policy, gate the new
  registration behind a feature flag until the program's surface is
  complete, so `main` stays deployable while sibling epics land.
- `get_app_context`'s permissions field is a static capability descriptor
  for now (see the epic's Open Question 7) — it must state that trading is
  not available, since the design doc deliberately excludes it.
- Tool descriptions are the agent's only documentation. Follow the existing
  `tools.ts` convention: say what the tool returns and what ID it hands
  back, so the agent can chain calls without guessing.
- Do not modify `src/lib/webmcp/tools.ts`, `src/lib/workspace/store.ts` or
  the current UI — EPIC-1015 retires those at the end of the program.

## Out of Scope

Any tool outside the seven named here; a UI for the new workspace; and
removing the old surface.
