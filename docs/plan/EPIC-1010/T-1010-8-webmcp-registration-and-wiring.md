# T-1010-8: WebMCP registration and end-to-end wiring for the Results tools and table-renderer contract

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Done
**Depends on**: T-1010-7
**Blocks**: —

## Description

The integration ticket: expose `get_screener_results` and
`explain_result` as WebMCP tools on the new surface, register the
table-renderer contract (T-1010-6) into EPIC-1007's source/renderer
registry so its `configure_panel_view` and `set_panel_selection` tools
resolve to this epic's behavior for `table`-rendered panels, and wire
both to the Wave 2 use cases and the `results_table` panel, with the tool
descriptions and schemas an agent needs to use them correctly on the
first try. After this ticket the epic's capability is reachable end to
end from an agent — two tools this epic registers directly, plus
configuration and selection reached through EPIC-1007's generic panel
tools.

## User Story

As an agent connected to the app,
I want to read and audit screener results directly, and to shape a
results table and select a row through the same generic panel tools I use
for every panel,
so that I can page a run, select a row, and audit a verdict without trial
and error, and without learning a results-specific tool for something
every other panel already does one way.

## Acceptance Criteria

1. Both `get_screener_results` and `explain_result` are registered on the
   new WebMCP surface and appear in the tool listing with names matching
   the design doc exactly. The table-renderer contract is registered into
   EPIC-1007's source/renderer registry under the `table` renderer name,
   and is reachable — not directly listed as a separate tool — through
   EPIC-1007's `configure_panel_view` and `set_panel_selection`.
2. Each of the two directly-registered tools' input schema declares its
   parameters with types, requiredness, and descriptions.
3. Each tool's description states what it returns and its key constraint —
   in particular that `get_screener_results` reads an existing run and
   never reruns it, and that `explain_result` covers rejected candidates as
   well as results.
4. Tools are advertised as available only when their preconditions hold
   (for example, a results tool requires a results panel bound to a run),
   following the existing availability convention.
5. Errors are returned in the surface's error shape with actionable
   messages: an unknown field names the field and the permitted set, a
   revision conflict names the current revision (surfaced through
   EPIC-1007's `configure_panel_view`/`set_panel_selection` when the
   table-renderer contract rejects a call), an expired run names the run
   and says to re-run the screener.
6. An end-to-end test drives the sequence configure (via
   `configure_panel_view`) → read page (`get_screener_results`) → select
   (via `set_panel_selection`) → explain (`explain_result`) against a run
   fixture and asserts the outcome of each step, including that no
   screener execution occurred at any point.
7. A round-trip test confirms an agent-driven configuration change made
   through `configure_panel_view` is visible in the rendered panel, and a
   panel-driven selection is visible to a subsequent `get_screener_results`
   or `explain_result` call.
8. The existing 11 pattern-research tools remain registered and
   functional, and the app builds and runs with both surfaces present.
9. The project CI gate passes: formatting, lint, type check, and the full
   test suite.

## Design References

- `docs/design/results-and-explain/spec.md` — the behavioral spec the
  end-to-end test traces.
- `docs/reference/tool-spec.md` — exact tool names, purposes, and the common
  contract.
- `src/lib/webmcp/register.ts` and `src/lib/webmcp/tools.ts` — the
  existing registration and `ToolSpec` conventions (`inputSchema`,
  `available`, `execute`, `ok`/`fail`) the new tools follow. Not modified
  by this epic.
- `src/lib/webmcp/integration.test.ts` — the existing end-to-end tool test
  pattern to follow.

## Technical Considerations

- Tool descriptions are the agent's only documentation — the existing
  `defineStudy` description, which returns the function catalog on a parse
  error, is the quality bar to match.
- Both surfaces coexist until EPIC-1015. Register the new tools alongside
  the old ones; do not remove or rename anything existing.
- AC6's "no screener execution" assertion should reuse the failing-on-
  execution run store double from T-1010-4 and T-1010-5 so the guarantee is
  enforced at the integration level too, not just per use case.

## Out of Scope

- Retiring the 11-tool pattern-research surface (EPIC-1015).
- Tools outside the Results area of the design doc.

## Solution Approach

### Scope corrections already resolved (do not redo)

- AC1's table-renderer-contract registration is already done by T-1010-7
  in `src/lib/panels/shell/registerPanelTools.ts` (verified by reading
  that file: it calls `registerResultsTableRendererContract` before the
  placeholder defaults). This ticket adds a test asserting the end state
  (`sourceRenderer.getRendererType('table')` is the real contract), not a
  new registration call.
- Only two tools are registered directly: `get_screener_results` and
  `explain_result`. `configure_panel_view`/`set_panel_selection` are
  EPIC-1007's tools, already wired to the table renderer contract's hooks
  (T-1010-6). No `configure_results_table`/`select_result` tools.

### Where the two tools register: `registerPanelTools.ts`, unflagged

`src/routes/workbench/+page.svelte` already calls `registerPanelTools()`
with no args (`createDefaultPanelShellRuntime()`), and that route is live
and separate from the old `/` route's 11-tool surface (`connectWebmcp` /
`registerScreenerTools.ts`, which stays untouched). Because the new
surface's composition root is not feature-flagged (per its own header
comment: "not new behavior layered into an existing runtime path"), the
two new tools plug into the same unflagged root, as a peer tool group next
to the existing five (`buildLifecycleTools`, `buildLayoutTools`,
`buildSourceRendererTools`, `buildLinkTools`, plus the implicit
`maximize_panel`).

New file: `src/lib/results/tools/resultsTools.ts`, exporting
`buildResultsTools(deps: ResultsToolDeps): ToolSpec[]`, mirroring
`panels/tools/panelTools.ts`'s `buildPanelTools` shape. `ResultsToolDeps`
extends `PanelUseCaseDeps` (for `repository`/`workspaceId`, to read panel
state) with `runs: PinnedRunStore` and an optional `resolveTicker`
(matching `ResultsPanelRuntimeDeps` in `resultsPanelContext.ts`).

`registerPanelTools.ts` changes:
- `PanelShellRuntime` gains a `runs: PinnedRunStore` field so the same
  `PinnedRunStore` instance the table renderer contract and the
  `results_table` panel kind already close over is also reachable from
  `registerPanelTools()` to build the results tools.
- `registerPanelTools()` builds `buildResultsTools({ ...runtime.deps, runs: runtime.runs })`
  and concatenates it with `buildPanelTools(runtime.deps)` before
  `wrapToolsWithNotify` (harmless for reads: `observer.notify()` after a
  read just triggers a re-render of state that did not change).

This keeps the 14 existing tools' registration path untouched and adds the
two new ones as an additive, same-shaped tool group — no new
`WorkbenchDeps`/legacy-composition-root feature flag, since this route was
never flagged to begin with.

### How `panel_id` resolves to `run_id` / `table_config` / selection

Both tools take `panel_id` (not a bare `run_id`), per the ticket's own
steer and per AC4's "a results tool requires a results panel bound to a
run" framing. Resolution mirrors `ResultsTablePanel.svelte`'s own
resolution exactly (same store, same panel, so the tool and the rendered
panel can never disagree):

1. Read the current document: `deps.repository.get(deps.workspaceId)`.
2. `readPanelState(doc).panels.find(p => p.id === panel_id)` -- unknown
   panel is an explicit `unknown_panel` error naming the id.
3. `run_id` comes from `panel.source` when `panel.source.type ===
   'screener_results'`, reading `panel.source.ref.run_id` -- unbound
   source is an explicit `unbound_panel` error (actionable: bind one via
   `bind_panel_source` first).
4. `get_screener_results` additionally parses `panel.config` through
   `parseWireResultsTableConfig` (falling back to
   `defaultResultsTableConfig()` on a parse failure or an
   as-yet-unconfigured panel), then calls `getScreenerResults(runs, {
   runId, cursor, pageSize, tableConfig })` -- byte-for-byte the same call
   the panel body makes.
5. Selection: `readPanelState(doc).selections[panel.id]` is the same
   selection `set_panel_selection` (agent-driven) and the panel's own
   `toggleRow` (human-driven, `setPanelSelection` with `actor: 'human'`)
   both write into. `get_screener_results`'s response includes
   `selected_result_ids` from this so a selection made either way is
   visible on the next read (AC7's second half). `explain_result`'s
   `instrument_id` is optional: when omitted, the tool resolves the first
   selected result id back to its `instrumentId` via the pinned run's
   matches (`mintResultId(runId, match.rank) === selectedId`), so a
   panel-driven (or agent-driven) selection is explainable without the
   caller re-deriving the instrument id itself. `instrument_id` is still
   accepted explicitly for the common case of explaining an arbitrary
   (including rejected, unselected) candidate.

### Errors

Reuses `panels/tools/results.ts`'s `ok`/`fail` (the new surface's own
shape), not `src/lib/webmcp/tools.ts`'s. `RunNotAvailable` outcomes are
mapped through `fail(message, { error: reason, run_id })`, with the
message extended (matching `explainResult.ts`'s own `runUnavailable`
suffix and `renderState.ts`'s `RUN_AGAIN_SUFFIX`) so both tools' expired/
unknown-run errors literally say to re-run the screener, satisfying AC5
for this ticket's own two tools directly (the unknown-field and
revision-conflict cases AC5 also names are already produced by
`configure_panel_view`/`set_panel_selection`, per the scope correction).

### Availability (AC4)

The new surface's `registerPanelTools()` registers all tools once,
statically, at mount time -- it does not consult `ToolSpec.available`
at all (confirmed by reading the function: only `name`/`description`/
`inputSchema`/`execute` are passed to `mc.registerTool`), unlike the old
surface's `register.ts`, which polls `available(ws)` after every call and
registers/retires tools dynamically. This gap predates this ticket and
applies equally to all 14 existing panel tools (every one of them passes
`available: always`), so building a parallel dynamic-registration loop
for just these two tools would be new infrastructure out of proportion to
one ticket, inconsistent with the other 14, and not something the ticket
asks for by itself.

Given that, this ticket implements `available` as a real, closure-based
predicate (`() => hasAvailableRunPanel(deps)`, ignoring its unused
`WorkspaceState` parameter exactly like the existing `always = () => true`
does) that reflects live state -- true only when at least one panel in the
current workspace is bound to a `screener_results` source whose run is
currently available. This satisfies AC4 at the interface/testable level
(unit-tested directly by calling `spec.available()` before and after
binding a panel to a run/evicting it) and is forward-compatible with a
future dynamic-registration loop, without expanding this ticket into
rebuilding the composition root's tool lifecycle for all 14+2 tools. Each
tool's `execute()` independently still produces an actionable error (not
a crash) when called despite the precondition not holding, so a caller
that ignores `available` is never left with a silent failure.

### Wire response shapes

- `get_screener_results`: `toWireProjectedResultsPage(outcome)` (already
  the exact shape `ResultsTablePanel.svelte` renders from) plus
  `selected_result_ids`.
- `explain_result`: `toWireResultExplanation(outcome)`.
Both already snake_case; no new serializer needed.

### Tests

- `src/lib/results/tools/resultsTools.test.ts`: unit tests per tool
  (schema shape, panel/run resolution errors, page/selection wiring,
  explain with and without `instrument_id`, `available()` before/after
  binding).
- `src/lib/results/tools/resultsTools.e2e.test.ts`: AC6's sequence
  (configure -> read -> select -> explain) against a harness that mirrors
  `registerPanelTools.ts`'s composition (real results kind + contract,
  injectable memory storage and a `createSpyPinnedRunStore`-wrapped
  `PinnedRunStore`), asserting `spy.putRunCalls` never increases past its
  initial fixture seed and that `PinnedRunStore` has no `execute` member
  reachable from any code path exercised (mutation-checked by
  temporarily wiring a rerun call in during development and confirming
  the test fails). Also covers AC7's round trip: a `configure_panel_view`
  change is reflected in a fresh `getScreenerResults` read (modeling "the
  rendered panel" the same way `renderState.test.ts` does, without
  mounting Svelte), and a `setPanelSelection` call with `actor: 'human'`
  (modeling the panel's own row click) is visible to both a subsequent
  `get_screener_results` (`selected_result_ids`) and `explain_result`
  (implicit `instrument_id`) call.
- `src/lib/panels/shell/registerPanelTools.test.ts`: extended with an
  assertion that `get_screener_results`/`explain_result` are present after
  `registerPanelTools()` and that the real `table` renderer resolves
  (AC1's verification, per the scope correction).
