# T-0020-1: Shared composition root; flip WORKBENCH_TOOLS_ENABLED and SCREENER_TOOLS_ENABLED

**Epic**: EPIC-0020 (Wire the workbench composition root)
**Design**: docs/design/workbench-composition-root/
**Status**: Done
**Depends on**: —
**Blocks**: T-0020-2

## Description

Today, `src/lib/panels/shell/registerPanelTools.ts`,
`src/lib/workbench/tools/registerWorkbenchTools.ts`, and
`src/lib/webmcp/screener/registerScreenerTools.ts` each call their own
`createDefault*Deps()`, building an independent `WorkspaceRepository`, ID
sequencer, idempotency cache, revision service, change history, and (for
screener tools) `PinnedRunStore`. `/workbench`'s `+page.svelte` currently
calls only `registerPanelTools()`. This ticket builds one shared set of
those instances and threads it through all three registration calls, so a
mutation or read through one tool group is visible to another — the
precondition every later ticket in this epic needs.

## Acceptance Criteria

1. A single module constructs exactly one `WorkspaceRepository`, ID
   sequencer, idempotency cache, revision service, change history, and
   `PinnedRunStore` for `/workbench`.
2. `registerPanelTools()`, `registerWorkbenchTools()`, and
   `registerScreenerTools()` all accept (or are called with) those shared
   instances instead of each building its own via `createDefault*Deps()`.
   Each function's existing default-deps constructor may remain for its own
   unit tests, but `/workbench`'s actual composition must not use it.
3. `WORKBENCH_TOOLS_ENABLED` (`src/lib/workbench/tools/registerWorkbenchTools.ts`)
   and `SCREENER_TOOLS_ENABLED` (`src/lib/webmcp/screener/registerScreenerTools.ts`)
   are both `true`.
4. Every other tool-group flag (`CHART_TOOLS_ENABLED`, `SIMILARITY_TOOLS_ENABLED`,
   and EPIC-1014's followup/backtest/alert/watchlist flags) is unchanged —
   still `false`.
5. `/workbench` still renders its seeded default layout
   (`filter_builder`/`results_table`/`chart`) with no regressions.
6. Existing tests asserting `WORKBENCH_TOOLS_ENABLED`/`SCREENER_TOOLS_ENABLED`
   default to `false` are updated to reflect the new `true` default for
   `/workbench`'s actual composition — distinguish "the flag's default
   value" (which may still start `false` for any *other* caller/route) from
   "what `/workbench` actually registers with" if the two diverge; if the
   flags are genuinely global constants, update the tests directly and
   note the behavior change in the commit body.
7. A new test proves shared-instance wiring: a mutation made through one
   tool group (e.g. a `workbench-core` tool call) is readable through
   another tool group's read path (e.g. `get_canvas_state` or an equivalent
   already-existing read) against the same underlying repository — not just
   that both are registered, but that they share state.
8. Full CI gate passes: typecheck, lint, format, frontend tests, build.

## Design References

- `docs/design/workbench-composition-root/spec.md` — "Shared composition
  root" behavioral scenarios.
- `src/lib/panels/shell/registerPanelTools.ts` — existing pattern for
  building and passing a `PanelShellRuntime`'s deps; the shape to extend
  rather than replace.
- `src/lib/webmcp/screener/registerScreenerTools.ts` and
  `src/lib/workbench/tools/registerWorkbenchTools.ts` — each already
  documents, in its own header comment, that it builds independent
  instances "since this ticket does not have to decide how a future single
  composition root shares one workspace repository across every tool
  group" — this ticket is that future decision.
- `docs/architecture/new-webmcp-surface.md` — "The composition root —
  currently unowned" section; update in T-0020-3, not here (this ticket
  implements the fix, T-0020-3 closes the doc gap once the whole epic is
  proven end-to-end).

## Out of Scope

- Auto-binding a screener run to the results panel (T-0020-2).
- The end-to-end integration test proving the full flow (T-0020-3).
- Any other tool group's flag.

## Solution Approach

New module: `src/lib/workbench/composition/workbenchCompositionRoot.ts`.

1. `createWorkbenchSharedInfra()` builds exactly one `repository`
   (`createLocalWorkspaceRepository`), `clock`, `ids`
   (`createIdSequencer`), `idempotency` (`createIdempotencyCache`),
   `history` (`createChangeHistory`), `revisions`
   (`createRevisionService({ repository, clock, ids, idempotency })`),
   and `runs` (`createPinnedRunStore`). Returned as one `WorkbenchSharedInfra`
   bag.
2. `registerPanelTools.ts` is refactored to extract
   `createDefaultPanelShellRuntime`'s body into a new exported
   `createPanelShellRuntime(shared: WorkbenchSharedInfra): PanelShellRuntime`
   that takes the 7 shared instances instead of building its own; panel-only
   registries (`kinds`, `sourceRenderer`, `templates`, `maximized`) stay
   locally constructed (AC1 does not name them). `createDefaultPanelShellRuntime()`
   becomes a 2-line wrapper: build a fresh `WorkbenchSharedInfra`, call
   `createPanelShellRuntime`. Existing tests calling
   `createDefaultPanelShellRuntime()` are unaffected.
3. `workbenchCompositionRoot.ts` builds `WorkbenchDeps` and `ScreenerToolDeps`
   objects directly (not via `createDefaultWorkbenchDeps`/
   `createDefaultScreenerToolDeps`, per AC2), reusing the shared
   `repository`/`revisions`/`history`/`clock`/`ids`/`idempotency`, plus each
   group's own non-shared extras (`registry: operationRegistry` — already a
   module singleton so naturally shared; a local fixed `provenance`;
   `catalog`/`instrumentDirectory` for screener; `runStore: shared.runs`).
4. `registerWorkbenchComposition()` builds the shared infra once, constructs
   the panel runtime + workbench deps + screener deps from it, calls
   `registerPanelTools(panelRuntime)`, `registerWorkbenchTools(workbenchDeps)`,
   `registerScreenerTools(screenerDeps)` in that order, and returns the
   `PanelShellRuntime` (so `+page.svelte` can still hand `deps`/`observer`
   to `PanelContainer`).
5. `src/routes/workbench/+page.svelte` calls `registerWorkbenchComposition()`
   instead of `registerPanelTools()`.
6. Flip `WORKBENCH_TOOLS_ENABLED` and `SCREENER_TOOLS_ENABLED` to `true` in
   their respective files. These are genuine global constants (not
   per-route config), so per AC6 the two "defaults to off" unit tests are
   updated in place to assert `true`/the new registered-tool-count behavior,
   and the commit body notes the behavior change explicitly.
7. New test (in `workbenchCompositionRoot.test.ts`): call
   `registerWorkbenchComposition()` against a stubbed
   `document.modelContext`, invoke the registered `create_panel` tool
   (panel tool group), then invoke the registered `get_canvas_state` tool
   (workbench-core tool group) and assert the new panel's id appears in
   its `panels` list — proving a mutation through one tool group is read
   through another against the same repository/revision state, not just
   that both are registered.
