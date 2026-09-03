# Workbench Composition Root

## Overview

`/workbench` (EPIC-1007's panel/grid surface) and the rest of the ~33-tool
WebMCP program (EPIC-1006 through EPIC-1014) were built as independent tool
groups, each tested and merged in isolation, each gated behind its own
`*_ENABLED` flag. Nothing assembles them into one live, working system: every
tool group builds its own private `WorkspaceRepository`, ID sequencer,
idempotency cache, revision service, change history, and (for screener tools)
`PinnedRunStore` — so even with flags flipped on, two tool groups registered
on the same page cannot see each other's data. This feature is the glue: one
shared runtime for `/workbench` that lets the panel shell and the
workbench-core/screener tool groups operate on the same underlying state, so
an agent can actually run a screener and see the result rendered in the grid.

## Preconditions

- EPIC-1006 (workspace/revisions contract), EPIC-1007 (panel system), and
  EPIC-1009 (screener core) are all merged to `main` and functionally
  complete behind their own flags — this feature does not change their
  internal logic, only how their tool groups are constructed and registered.
- `/workbench` already renders its seeded default layout (`filter_builder`,
  `results_table`, `chart` panels) via `registerPanelTools()` with no flag of
  its own.

## Features

1. **Shared composition root**: `/workbench` constructs exactly one
   `WorkspaceRepository`, ID sequencer, idempotency cache, revision service,
   change history, and `PinnedRunStore`, and every tool group registered on
   that page (panel tools, workbench-core tools, screener tools) is built
   against those same shared instances rather than each building its own.
2. **Live screener + workbench-core tools**: `WORKBENCH_TOOLS_ENABLED` and
   `SCREENER_TOOLS_ENABLED` are on for `/workbench`, so an agent can call
   `create_screener`, `set_screener_universe`, `edit_filter_tree`,
   `set_screener_ranking`, `validate_screener`, `run_screener`, and the
   workbench-core tools (`get_app_context`, `get_canvas_state`,
   `create_workspace`, `save_workspace`, `undo_change`, `get_change_history`,
   `restore_workspace_revision`), and have them mutate the same workspace the
   panel grid renders.
3. **Automatic run-to-panel binding**: a completed screener run is
   automatically visible in the workspace's results panel, with no separate
   binding step required from the agent.

## Behavioral Specifications

### Shared composition root

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | `/workbench` loads | tools register | panel tools, workbench-core tools, and screener tools are all built against the same `WorkspaceRepository`/`PinnedRunStore`/id-sequencer/idempotency-cache/revision-service/change-history instances — a mutation made through one tool group is visible to a read through another |
| Flags still gate the rest | the shared composition root exists | `/workbench` loads | chart, similarity, backtest, alerts, watchlist, and followup tool groups remain unregistered — only workbench-core and screener tools are added to what was already live |

### Live screener flow

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | an agent on `/workbench` | calls `create_screener`, `set_screener_universe`, `edit_filter_tree`, `run_screener` in sequence | the call succeeds and returns a pinned `run_id`, using the shared workspace state the panel grid also reads |
| Validation still applies | an agent defines an invalid screener (e.g. an empty filter tree, per screener-core's existing validation) | `run_screener` is called | it is rejected the same way it already is today when screener tools run in isolation — this feature changes wiring, not screener-core's own behavior |

### Automatic run-to-panel binding

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | the workspace's default seeded layout (one `results_table` panel) | a screener run completes successfully | that `results_table` panel's source is automatically bound to the new run's `run_id`, and its rendered rows update to the run's matches without a separate `bind_panel_source` call |
| No results panel present | a workspace with no `results_table` panel (e.g. it was closed) | a screener run completes | `run_screener` still succeeds and returns its `run_id` — binding is best-effort, never a precondition for the run itself to succeed |
| Multiple results panels present | a workspace with more than one `results_table` panel | a screener run completes | the first `results_table` panel found in the workspace's panel list is bound; binding to more than one, or letting the agent choose which, is out of scope for this feature (see Non-Goals) |

## Non-Goals

- Chart, similarity, backtest, alert, watchlist, and followup tool groups
  staying live on `/workbench` — those flags stay off; this feature only
  turns on workbench-core and screener tools.
- Choosing which panel to bind when a workspace has more than one
  `results_table` panel — the first one found is bound; a deliberate
  multi-panel targeting mechanism (e.g. an explicit `bind_panel_source` call)
  is future work if that scenario becomes real.
- Changing `run_screener`'s, `edit_filter_tree`'s, or any other screener-core
  tool's own validation or matching behavior — this feature is wiring only.
- EPIC-1015's legacy-surface-cutover capability-parity decisions (multi-step
  temporal patterns, `measure`/`split_instances`, progressive tool
  availability, etc.) — those stay open/deferred, unaffected by this work.
- Production deployment or flipping these flags anywhere other than the
  `/workbench` route's own composition.

---

*Implemented by: EPIC-0020*
