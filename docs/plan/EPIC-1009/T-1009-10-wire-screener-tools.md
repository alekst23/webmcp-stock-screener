# T-1009-10: Wire the six screener tools into the new WebMCP surface

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: T-1009-3, T-1009-8, T-1009-9
**Blocks**: —

## Description

The integration ticket: register all six screener tools on the new WebMCP
surface, connect the browser-side definition tools to the backend
validation and execution tools, and prove the whole sequence works end to
end — create, universe, filters, ranking, validate, run — without
touching the existing 11-tool surface.

## User Story

As an AI agent connected to the app,
I want the six screener tools to be discoverable and callable in sequence,
so that I can go from an empty workspace to a pinned run of results in
one conversation.

## Acceptance Criteria

1. All six tools — `create_screener`, `set_screener_universe`,
   `edit_filter_tree`, `set_screener_ranking`, `validate_screener`,
   `run_screener` — are registered on the WebMCP surface, discoverable
   with descriptions and input schemas, and callable.
2. The two backend-dependent tools reach the validation and execution
   engine over HTTP using the project's existing route, schema, and
   error-mapping conventions, and a backend failure surfaces as a tool
   error an agent can act on rather than an unhandled rejection.
3. An end-to-end test drives the full sequence — create a screener, set a
   universe, add and group conditions of several types, set ranking,
   validate, run — and asserts a pinned `run_id` with correct counts and
   complete provenance comes back.
4. An end-to-end test asserts that reading the run after further screener
   edits still describes the executed revision.
5. Undoing a screener mutation with its returned undo token restores the
   prior screener state.
6. The existing 11 tools remain registered and behave exactly as before;
   `src/lib/webmcp/tools.ts`, `src/lib/workspace/store.ts`, and the
   current UI are unmodified.
7. The full check suite passes — formatting, linting, type checking, and
   both the Vitest and backend test suites — and the app builds and
   serves.

## Design References

- `docs/design/screener-core/spec.md` — the end-to-end sequence the
  integration test follows.
- `docs/design/screener-core/technical.md` — the definition/execution
  boundary that decides which tools are browser-side and which call the
  backend.
- `src/lib/webmcp/register.ts` and `src/lib/webmcp/integration.test.ts` —
  the existing registration path and integration-test style to follow.
- `docs/reference/deployment.md` — the deployed frontend/backend topology
  the networked tools run against.

## Technical Considerations

- Registering a second tool group alongside the existing one changes
  behavior in an existing code path, so gate the new surface behind a
  feature flag until the epic is complete, per the project's dead-code
  policy.
- Both new tool groups must coexist with the existing 11 without name
  collisions.

## Out of Scope

Any screener UI panel, retiring the old surface (EPIC-1015), and the
results tools (EPIC-1010).
