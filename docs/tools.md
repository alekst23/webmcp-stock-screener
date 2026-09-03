# WebMCP Tool Surface

MarketPane is a screener and research workbench, not the original
event-atom hypothesis workbench (that surface was retired in EPIC-1015 —
see "Capability changes" below). The atom now is an **instrument**: an
agent and a human build a typed filter tree over a universe of
instruments, run it, inspect and chart the results, find historically
similar setups, and act on what they find, all through one shared
workspace document both sides can read and mutate.

## Nouns

| Handle | Meaning |
|---|---|
| Workspace | The one document a session reads and mutates: panels, layout, links, screeners, and revision history. Created automatically on first load. |
| Panel | A rendered view on the canvas (results table, chart, watchlist, alert draft, similar-setups, filter builder, ...), addressable by ID. |
| Screener | A saved definition: a typed filter tree, a universe, and a ranking. |
| Run | A pinned execution of a screener — the result set every read tool below returns bounded slices of, without silently re-running it. |
| Filter tree | A typed AND/OR tree of condition nodes (comparison, cross, temporal, pattern, rank, and more) that a screener evaluates per instrument. |
| Instrument | A tradable security resolved from free text to a canonical ID via the catalog. |
| Captured setup | A saved chart configuration (instrument, interval, studies, view) used as a similarity-search seed. |

## Tool groups

Every group below registers unconditionally once the WebMCP bridge
connects — there is no legacy-style progressive registration (see
"Capability changes"). ~39 tools are live in the shipped app today,
composed by `src/lib/workbench/composition/workbenchCompositionRoot.ts`
(the sole call site, from `src/routes/+page.svelte`).

| Group | Tools | Full contract |
|---|---|---|
| Panels (14) | `create_panel`, `duplicate_panel`, `remove_panel`, `set_panel_layout`, `apply_layout_template`, `split_panel`, `maximize_panel`, `link_panels`, `unlink_panels`, `set_panel_selection`, `bind_panel_source`, `set_panel_renderer`, `configure_chart_grid`, `configure_panel_view` | [Panel System](design/panel-system/spec.md) |
| Results (2) | `get_screener_results`, `explain_result` | [Results & Explain](design/results-and-explain/spec.md) |
| Workspace & safety (9) | `get_app_context`, `get_canvas_state`, `create_workspace`, `save_workspace`, `undo_change`, `get_change_history`, `restore_workspace_revision`, `preview_workspace_changes`, `apply_previewed_changes` | [Workspace & Revisions](design/workspace-revisions/spec.md), [Safety: Preview & Apply](design/safety-preview-apply/spec.md) |
| Screener (6) | `create_screener`, `edit_filter_tree`, `set_screener_ranking`, `run_screener`, `set_screener_universe`, `validate_screener` | [Screener Core](design/screener-core/spec.md) |
| Chart (3) | `get_chart_data`, `capture_chart_setup`, `add_chart_annotation` | [Chart Tools](design/chart-tools/spec.md) |
| Similarity (3) | `find_similar_setups`, `explain_similarity`, `compare_setups` | [Similarity Search](design/similarity-search/spec.md) |
| Follow-up authoring (2) | `create_computed_field`, `create_custom_study` | [Screener Follow-up Tools](design/screener-followup-tools/spec.md) |

`get_canvas_state` sees every registered panel kind, not a fixed set —
its read path widens to whatever the panel-kind registry actually holds
(T-1015-11 fixed a pre-existing blind spot here; see "Capability
changes").

### Not yet part of the live tool surface

The rest of the follow-up-tools group — `derive_filters_from_setup`,
`refine_similarity_search`, `backtest_screener`, `get_backtest_results`,
`upsert_watchlist`, `save_results_to_watchlist`, `create_alert_draft`,
`edit_alert_draft`, `enable_alert`, `disable_alert`, `preview_alert`,
`export_results` — is real, merged, tested code, but is not registered by
`workbenchCompositionRoot.ts` and each module's own `*_TOOLS_ENABLED`
flag (`BACKTEST_TOOLS_ENABLED`, `WATCHLIST_TOOLS_ENABLED`,
`ALERT_TOOLS_ENABLED`, `FILTER_DRAFT_TOOLS_ENABLED`) is still `false`. The
default workspace does seed `watchlist` and `alert_draft` panels (they
render whatever state exists, currently empty) ahead of the tools that
would populate them — wiring this group in is follow-up scope beyond
this cutover, not a capability this ticket dropped.

## Availability rules

- Every tool operates on the one active workspace, seeded automatically
  on first load — there is no "no workspace yet" state to gate on.
- A few tools depend on prior state from an earlier call in the same
  session (for example `run_screener` before `get_screener_results`,
  `capture_chart_setup` before `find_similar_setups`, a screener/pinned
  run/captured setup before the five availability-gated follow-up-
  authoring tools). Calling one before its precondition exists returns an
  error result naming what's missing, per the result contract below — it
  does not throw and does not silently no-op.
- Nothing is gated on a runtime `toolchange`-style unlock: every group
  above is either fully registered or fully absent for the whole
  session. See "Capability changes."

## Result contract

Every tool returns MCP's content-block shape,
`{ content: [{ type: 'text', text }] }`, with the payload JSON-encoded in
`text`. A failure sets `isError: true` on the same shape rather than
throwing, so an agent gets a structured reason it can act on in the next
turn. Both shapes come from one shared pair of constructors,
`ok()`/`fail()` (`src/lib/webmcp/toolResult.ts`), used by every tool
group above.

## Capability changes since the legacy 11-tool surface

EPIC-1015 retired the original 11-tool event-atom workbench
(`defineStudy`, `defineSetup`, `findInstances`, `sampleInstances`,
`measure`, `splitInstances`, `showGrid`, `showTickerCharts`,
`clearPanels`, `focusInstance`, `getWorkspace`) in favor of the surface
above. `docs/plan/EPIC-1015/capability-parity-matrix.md` is the full
audit; the ten items below are its structural-gap findings, carried
forward here because a capability gap is exactly what a reader of this
file would come looking for.

**Accepted as deliberate drops** — the user signed off on each of these
as an acceptable loss, not an oversight:

1. **Multi-step temporal sequencing.** The legacy `defineSetup` could
   anchor step 2's window to the specific occurrence step 1 resolved on.
   `edit_filter_tree`'s temporal condition type is a single-predicate
   lookback per node; a filter tree can express "A happened recently AND
   B happened recently," not "B happened within N days after that
   specific A."
2. **Outcome measurement as arbitrary metric-vs-universe comparison**
   (`measure`). `backtest_screener`/`get_backtest_results` compute a
   different shape — forward-return and drawdown stats after a signal —
   not a generic statistic-vs-base-rate comparison. (Also still unwired;
   see "Not yet part of the live tool surface.")
3. **Instance splitting into labeled child sets** (`splitInstances`). No
   tool partitions a result set into independently-usable winner/loser
   or by-condition subsets.
4. **Instance focus as a concept distinct from human selection**
   (`focusInstance`). The new surface has one selection model
   (`set_panel_selection`), not a separate agent-driven "zoom to this
   one" state.
5. **Progressive tool availability** (the legacy `toolchange`
   demonstration — tools like `measure` appearing only once a result set
   existed, via `register.ts`'s desired-vs-registered diff). Every group
   in the table above registers unconditionally for the whole session
   instead.
6. **The manual tool-harness route** (`/dev`, hand-invoke any tool with
   raw JSON). No replacement route exists; a developer convenience, not
   a researcher-facing feature.

**Shipped as new scope, not dropped** — these were flagged as gaps during
the parity check and closed by tickets in this same epic before cutover:

7. **Human-clickable single-panel close.** Every panel frame has a close
   control (T-1015-10) with the same effect as the agent-side
   `remove_panel` tool, including for panels an agent created.
8. **Unified, human/agent-attributed action log.** `get_change_history`
   and every recorded mutation now carry an `actor: 'human' | 'agent'`
   field; the shell's compact log icon (T-1015-10) expands into the full
   attributed history.
9. **Workspace-status header.** The shell (T-1015-9) reports product
   identity, data freshness, and WebMCP bridge/tool-count status — the
   equivalent of the legacy page's header, rebuilt rather than reused.
10. **`get_canvas_state`'s panel-state blind spot.** Fixed (T-1015-11):
    the read path now covers every registered panel kind instead of a
    closed set fixed when the read model was first built, which is also
    what let T-1015-12 seed `watchlist` and `alert_draft` panels by
    default and have them show up through this tool.
