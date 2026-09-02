# T-1014-11: Register and integrate the follow-up tool surface

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Done
**Depends on**: T-1014-2, T-1014-3, T-1014-4, T-1014-6, T-1014-7,
T-1014-9, T-1014-10
**Blocks**: — (unblocks EPIC-1015 cutover)
**Issue**: —

## Description

The wiring ticket. Register all 13 follow-up tools on the new WebMCP
surface with descriptions and input schemas an agent can actually use,
make availability reflect workspace state, and prove the end-to-end flows
the epic exists for.

Each preceding ticket delivers a capability. This one makes the set
usable as a whole and verifies the epic's cross-cutting guarantees hold
across every tool at once, rather than one ticket at a time.

## User Story

As an AI agent connected to the workbench,
I want the follow-up tools discoverable, well-described, and callable
alongside the core surface,
so that I can carry a piece of research from a screen through refinement,
validation, and saving without falling off the end of the tool set.

## Acceptance Criteria

1. All 13 follow-up tools — `refine_similarity_search`,
   `derive_filters_from_setup`, `create_computed_field`,
   `create_custom_study`, `backtest_screener`, `get_backtest_results`,
   `upsert_watchlist`, `save_results_to_watchlist`, `create_alert_draft`,
   `preview_alert`, `enable_alert`, `disable_alert`, and
   `export_results` — are registered on the new surface, discoverable
   with a description and an input schema, and callable end to end.
2. Tool availability reflects workspace state: a tool whose
   prerequisites are absent (no screener, no pinned run, no captured
   setup, no similarity search) is reported unavailable rather than
   failing opaquely when called.
3. Every tool's description tells an agent when to reach for it and what
   it returns, and every input schema names the stable-ID inputs it
   expects.
4. A cross-tool test verifies the mutation contract uniformly: for every
   mutating tool in this epic, a stale `expected_revision` is rejected
   without mutating, a repeated `idempotency_key` returns the original
   result without re-applying, and the response carries the full
   envelope.
5. A cross-tool test verifies that every mutation this epic creates is
   reversible through `undo_change` with its returned undo token.
6. An adversarial test enumerates the registered surface and confirms no
   sequence of calls transitions an alert to armed without a human
   confirmation.
7. An end-to-end test covers the epic's principal flow: derive a draft
   filter tree from a captured setup, accept it onto a screener, run and
   backtest it, save the results to a watchlist, draft and preview an
   alert, and export the pinned run — with provenance present at every
   step that carries market data.
8. A second end-to-end test covers the authoring and refinement flow:
   create a computed field and a custom study, use them in a filter and
   on a chart, then refine a similarity search from accepted and rejected
   matches.
9. Resources created by this epic — computed fields, custom studies,
   draft filter trees, backtests, watchlists, alerts, exports — are
   visible to the researcher through the workspace and its panels, not
   only through tool responses.
10. The legacy 11-tool surface, `src/lib/workspace/`, and the current UI
    are unmodified; the app builds, typechecks, and the full test suite
    passes.

## Design References

- `docs/design/screener-followup-tools/spec.md` — the full scenario set;
  the "Contract obligations shared by every mutating tool here" table is
  what AC4 and AC5 verify.
- `docs/reference/tool-spec.md` — the complete follow-up tool list and the
  common contract.
- `docs/plan/EPIC-1006/_epic.md` — the mutation envelope, revision
  checks, idempotency, and `undo_change` that the cross-tool tests
  exercise.
- `docs/plan/EPIC-1007/_epic.md` — the panels through which created
  resources become visible.
- `src/lib/webmcp/tools.ts`, `src/lib/webmcp/register.ts`,
  `src/lib/webmcp/bridge.ts` — the existing registration, availability
  (`available(ws)`), and page-owned bridge patterns, for reference; this
  ticket registers on the new surface and does not modify these.

## Technical Considerations

- Tool descriptions are the agent's entire documentation. Descriptions
  that say what a tool does but not when to use it produce agents that
  never call it.
- The follow-up surface is large. Availability gating is what keeps it
  from overwhelming an agent that has not yet built a screener.
- The cross-tool contract tests (AC4, AC5) should be driven off the
  registered tool list, so a tool added later without the envelope fails
  the test rather than slipping through.
- AC6 is a regression guard for the epic's central safety property; it
  belongs in the permanent suite, not a one-off check.

## Out of Scope

- Retiring the legacy surface (EPIC-1015).
- Any change to the core epics' tools.
- New panel kinds — this ticket binds to the ones EPIC-1007 provides.
- Live verification against real market data, which waits on the parallel
  market-data workstream.

## Solution Approach

### Flag vs. direct wiring

Every preceding ticket's `register<Group>Tools.ts` wraps a real
`build<Group>Tools(deps)`/`create<Tool>Tool(deps)` factory behind a
module-level `..._ENABLED = false` flag that is read **inside the
`register*` function itself**, not by its caller — so the flag is live
gating, not dead code. `registerPanelTools.ts` (EPIC-1007's own
composition root, already called from `+page.svelte`) proves the
established alternative: a composition root with *no* flag that builds
deps and calls `mc.registerTool` directly.

This ticket's composition root (`registerAllFollowupTools.ts`) follows
`registerPanelTools.ts`'s precedent: it imports each group's `build*`
factory directly (`buildFollowupAuthoringTools`, `buildDeriveFiltersFromSetupTool`,
`buildRefineSimilaritySearchTool`, `createBacktestScreenerTool`,
`createGetBacktestResultsTool`, `buildWatchlistTools`, `buildAlertTools`,
`buildExportResultsTool`) and registers the resulting `ToolSpec[]` itself,
never calling the sibling `register<Group>Tools()` wrapper functions. Every
sibling ticket's own `..._ENABLED` flag is left `false` and untouched —
those flags gate *their own* standalone composition root, which stays an
independent, unused entry point; this ticket adds a second, parallel entry
point that composes the underlying factories directly. This is the
"register on the new surface" instruction read literally: `ensureModelContext()`
+ `registerTool`, matching every sibling file's own final loop, just from
one composition root instead of eight.

### Shared runtime

One `FollowupSurfaceRuntime` is built once (`createDefaultFollowupSurfaceDeps`)
and threaded into every group's deps object — never a private
repository/ids/history/registry per group:

- `repository`: one `WorkspaceRepository` (real localStorage-backed by
  default, in-memory `Storage` in tests).
- `clock`, `ids` (one `IdSequencer`, kinds never collide across groups so
  no seed-merging is needed the way a single group's own composition root
  needs it across a reload), `idempotency`, `history`: one each.
- `registry`: one fresh `OperationRegistry` (`createOperationRegistry()`,
  not the module-level singleton — avoids cross-test pollution the same
  way `alertActivationSafety.test.ts` already does).
- `catalog`: `composeWorkspaceCatalogRegistry(doc)`, rebuilt fresh at
  runtime-build time from the active workspace, then passed to every group
  that accepts an optional `catalog` override (followup authoring, filter
  draft, alerts) — this is what makes a created computed field/custom
  study immediately usable as a filter operand or alert condition.
- `runs`: one `PinnedRunStore`, wrapped by a small
  `createTrackedPinnedRunStore` decorator (new file,
  `followup/infra/trackedPinnedRunStore.ts`) that adds a `hasAnyRun()`
  read without changing `screener/runStore.ts`'s own contract — needed for
  AC2's "no pinned run" gate, since `PinnedRunStore` has no enumeration
  method of its own.
- `kinds`/`sourceRenderer`/`templates`: one panel registry set (defaults +
  `similar_opportunities`), needed because `refine_similarity_search`
  takes a full `PanelUseCaseDeps` (it rebinds the `similar_opportunities`
  panel). This is also what AC9's visibility tests bind panels against.
- `workspaceId`: resolved once (create-if-absent), matching
  `registerPanelTools.ts`'s own `initializeWorkspace` precedent.

### Availability gating (AC2)

None of the 13 tools' own `ToolSpec.available` does real gating — every
one hard-codes `available: () => true` (the field is legacy-shaped,
`(ws: WorkspaceState) => boolean` against the *old* 11-tool
`WorkspaceState`, and `mc.registerTool` never even reads it). AC2 is this
ticket's own responsibility to add, not something to inherit.

New pure domain module `followup/domain/followupAvailability.ts` maps a
tool name + parsed input against a `{ hasScreener, hasPinnedRun,
hasCapturedSetup, hasSimilaritySearch }` snapshot to an unmet prerequisite,
covering the ticket's four named categories against the five tools that
have a workspace-wide prerequisite: `backtest_screener` (screener),
`save_results_to_watchlist`/`export_results` (pinned run),
`derive_filters_from_setup`'s default/`derive` operation (captured setup),
`refine_similarity_search` (an existing `similar_opportunities` panel
bound to a run). The composition root wraps just those five tools'
`execute` with a live snapshot check (read fresh from the repository/run
store on every call, never cached at registration time) that short-circuits
to a distinct `{ error: 'unavailable', reason, message }` result before
the tool's own logic runs — satisfying "reported unavailable rather than
failing opaquely when called" without duplicating `webmcp/register.ts`'s
dynamic register/retire lifecycle (out of scope: that lifecycle is
specific to the legacy `ResearchEngine`/`WorkspaceState`, and every other
sibling composition root in this program registers its tools once,
statically).

### Descriptions and schemas (AC3)

Already satisfied by every preceding ticket's own `ToolSpec.description`/
`inputSchema` — this ticket adds no new prose, it composes what exists.
Verified by an inventory test asserting every registered tool has a
non-trivial description and an object schema naming its stable-id inputs.

### Cross-tool tests (AC4-AC6)

Driven off `registerAllFollowupTools`'s own returned tool list (never a
hand-maintained name list), per the ticket's own instruction:

- **AC4**: every tool whose schema accepts both `expected_revision` and
  `idempotency_key` is exercised for stale-revision rejection (no
  mutation), idempotent replay (same result, no second commit) and
  envelope shape.
- **AC5**: of AC4's mutating set, every tool whose *first successful* call
  returns a non-null `undo_token` is exercised through `undo_change`,
  asserting the pre-call state is restored. `backtest_screener` and
  `disable_alert` are structurally undo-token-null (documented in their
  own source) and are asserted to be exactly that set, not silently
  skipped.
- **AC6**: extends `alerts/tools/alertActivationSafety.test.ts`'s proof
  (already exhaustive for the 5-tool alert surface alone) to the full ~14-tool
  registered surface: no tool name matches `arm_`/`confirm_`/`decline_`,
  no source file under any registered group's `tools/` directory imports
  `confirmAlertActivation`/`declineAlertActivation`, and a representative
  adversarial sequence (every alert-relevant tool interleaved with the
  rest of the surface, repeated for idempotent-replay and undo/redo paths)
  never reaches `armed`.

### End-to-end tests (AC7, AC8)

Both build fixtures by calling sibling epics' own `build*Tool`/`buildScreenerTools`
factories directly against this ticket's shared repository/deps (never
their gated `register*Tools()` wrapper, and never flipping a sibling
epic's own flag) — the same pattern `captureChartSetup.test.ts` already
uses to seed a chart panel + series fixture. This is fixture composition
for tests, not production wiring of another epic's surface.

- **AC7** (principal flow): `create_screener` (EPIC-1009, called directly
  for the test) → seed a chart panel + series → `capture_chart_setup`
  (EPIC-1011) → `derive_filters_from_setup` (derive, then accept) →
  `run_screener` (EPIC-1009) → `backtest_screener` → `save_results_to_watchlist`
  → `create_alert_draft` → `preview_alert` → `export_results`. Asserts
  provenance is present at every step touching market data.
- **AC8** (authoring/refinement flow): `create_computed_field` +
  `create_custom_study` → use the field in `derive_filters_from_setup`'s
  edited draft / a screener filter and the study on a chart (via
  `edit_chart_studies`'s operation, EPIC-1011) → seed a `similar_opportunities`
  panel bound to a fake `SimilarityApiPort` run → `refine_similarity_search`
  with accepted/rejected matches.

### Visibility (AC9)

Watchlists bind to the real `watchlist` panel kind (`bindingTypes:
['watchlist', 'symbol_list']`, already registered by
`registerDefaultPanelKinds`) via `bind_panel_source` — proven directly.
Computed fields/custom studies, draft filter trees, alerts and backtests
are workspace-document-native (or, for backtests, id-addressable) state
readable independent of the tool call that created them (`get_canvas_state`,
`readComputedFields`/`readCustomStudies`/`readFilterDraft`/`readAlert`,
`get_backtest_results`) — exercised in the AC7/AC8 tests by reading state
back through a second, independent call rather than only inspecting the
creating call's own response.

### Files

- New: `src/lib/workbench/followup/infra/trackedPinnedRunStore.ts`
- New: `src/lib/workbench/followup/domain/followupAvailability.ts` (+ test)
- New: `src/lib/workbench/followup/tools/registerAllFollowupTools.ts` (+ test)
- New: cross-tool/e2e test files under `src/lib/workbench/followup/tools/`
- No sibling composition root, flag, `webmcp/tools.ts`, `webmcp/register.ts`,
  `webmcp/bridge.ts`, `src/lib/workspace/`, or current UI file is modified.
  `git diff --stat` against every pre-existing tracked file (excluding this
  ticket doc) is empty.

### Finding: custom studies cannot actually be plotted on a chart today

AC8 asked for a custom study to be "used ... on a chart". Building that
end-to-end (`followupAuthoringFlow.e2e.test.ts`) surfaced a real, pre-existing
gap: `chart/domain/studyEngine.ts`'s `isStudySupported()` gate (used by
`chart.edit_studies` via `resolveStudyItem`) only recognizes a fixed,
hand-written whitelist of built-in calculator ids (SMA/EMA/RSI/MACD/
Bollinger/ATR/VWAP). A custom study's id (`study.custom.*`) is never in that
list, regardless of what function it wraps, and there is no
expression-interpretation path in the chart engine at all — so
`chart.edit_studies` rejects adding a custom study to a chart with
`"... is a catalog study this chart cannot plot"` unconditionally.

This is a structurally missing capability in EPIC-1011 (a chart-side
custom-study evaluator), not a wiring gap this ticket's composition root can
route around, and not in scope for T-1014-11 to add (out of scope: "any
change to the core epics' tools"). The test asserts this rejection
explicitly (`toThrowError(/cannot plot/)`) rather than silently avoiding it,
and instead demonstrates the two usages that *are* real and spec-committed
today: a custom study used in a `study_output` filter condition (validates
purely against the catalog, no chart-engine involvement), and catalog
discoverability with the same declared shape (`outputs`, `parameters`) a
built-in study has. Flagged here for whoever picks up chart-side custom
study rendering next.
