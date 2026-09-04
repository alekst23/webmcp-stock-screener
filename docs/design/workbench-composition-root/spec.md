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
  its own. (Note: EPIC-1015's legacy-surface-cutover later retired the
  `/workbench` path and moved this same panel/workspace system onto `/` —
  "the workbench route" below means whichever path serves it, not literally
  `/workbench`.)
- The workspace has exactly one *current* screener at a time
  (`WorkspaceDocument.screenerId`); there is no multi-screener-per-workspace
  model. `filter_builder` panels mirror that one current screener, not an
  independent screener each.

## Features

1. **Shared composition root**: the workbench route constructs exactly one
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
4. **Create-if-absent results panel**: if the workspace has no
   `results_table` panel yet when a screener run completes, one is created
   automatically and bound to that run — an agent or human never has to
   create the panel by hand first to see results.
5. **Human-triggered run**: a human can run the current screener directly
   from the filter panel, without needing an agent to call `run_screener`,
   and see the results panel update the same way it would for an
   agent-triggered run.
6. **Recycled results panel**: rerunning the current screener — by agent or
   human — updates the same results panel in place. Repeated runs never pile
   up additional panels.
7. **Disambiguated revision parameters**: the tool surface makes it
   unmistakable which revision concept — the workspace's or the screener
   definition's own — a parameter refers to, both in what the tool
   describes and in what a rejection says when the wrong one is supplied.
8. **Diagnosable chart data gaps**: when a chart panel's bound instrument
   has no data in the historical price store, the chart states which
   instrument is unavailable and as of when, instead of an unexplained
   failure.

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
| No results panel present | a workspace with no `results_table` panel (e.g. it was closed, or never existed) | a screener run completes | one is created (see Create-if-absent results panel) and bound to the run — `run_screener` still succeeds even if panel creation is unnecessary for the run itself to have executed |
| Multiple results panels present | a workspace with more than one `results_table` panel (only reachable today by a human manually creating an extra one through the general panel tools) | a screener run completes | the first `results_table` panel found in the workspace's panel list is bound; choosing among several manually-created panels stays out of scope (see Non-Goals) |

### Create-if-absent results panel

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | the workspace has no `results_table` panel | a screener run completes successfully | a `results_table` panel is created (2 columns by 1 row, placed by the panel system's existing default auto-placement rule — no new placement logic) and bound to the run in the same operation |
| Existing panel takes precedence | a `results_table` panel already exists | a screener run completes | no new panel is created; the existing panel is rebound instead (see Recycled results panel) |

### Human-triggered run

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a screener is currently defined and no run triggered from this control is already in flight | a human uses the filter panel's run control | the same execution the `run_screener` tool performs runs — evaluate, pin the run, create-or-rebind the results panel — attributed to the human actor, and the control shows a running state until it finishes |
| No screener defined yet | no screener is currently defined for the workspace | a human views the filter panel | the run control is disabled, with an explanation that a screener must be defined first, rather than being clickable and failing |
| Run already in flight | a human-triggered run is in progress | the human activates the control again | the control stays disabled/showing its running state; it does not trigger a second concurrent run |
| Recorded like any other action | a human-triggered run completes, successfully or not | — | it appears in the workspace's action log/activity feed the same way an agent's `run_screener` call would, attributed to the human actor |

### Recycled results panel

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | the current screener already has a bound results panel | it is rerun, by agent or human, and completes | that same panel is rebound to the new run — no additional panel is created, and its rendered rows update in place |
| Manually duplicated panel (unchanged) | a human has manually created a second `results_table` panel through the general panel tools | a screener run completes | the first `results_table` panel found is (re)bound, per the existing first-found rule — this feature does not add a way to choose among manually-created duplicates |

### Disambiguated revision parameters

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | an agent inspects `run_screener`'s or `define_screener`'s parameters | it reads what each revision-shaped parameter means | the workspace's own revision and the screener definition's own revision are described distinctly enough that the two cannot reasonably be conflated |
| Wrong revision supplied | an agent passes one revision value where the other is expected | the tool rejects the call | the rejection names which revision concept was expected and which value was actually received |

### Diagnosable chart data gaps

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a chart panel is bound to an instrument with no data in the historical price store | the chart attempts to render | it states which instrument is unavailable and the data's as-of date, instead of an unexplained failure |

## Non-Goals

- Chart, similarity, backtest, alert, watchlist, and followup tool groups
  staying live on the workbench route — those flags stay off; this feature
  only turns on workbench-core and screener tools.
- Choosing which panel to bind when a human has manually created more than
  one `results_table` panel — the first one found is bound; a deliberate
  multi-panel targeting mechanism (e.g. an explicit `bind_panel_source` call)
  is future work if that scenario becomes real. (This is narrower than it
  once was: the ordinary "no panel yet" case is no longer in this Non-Goal —
  see Create-if-absent results panel.)
- A multi-screener-per-workspace model — the workspace has exactly one
  current screener; recycling and create-if-absent both operate on that one
  screener's results panel, not a per-screener registry.
- A UI for editing the screener definition by hand — screener-core's own
  Non-Goal (redefinition is agent-driven only) is unchanged; this feature
  adds a way to *run* the existing definition, not edit it.
- Sourcing real instrument reference data to resolve the provisional `XUNK`
  placeholders behind some chart data gaps — tracked separately (issue #32);
  this feature only makes the resulting error legible, not resolves the
  underlying gap.
- Changing `run_screener`'s, `edit_filter_tree`'s, or any other screener-core
  tool's own validation or matching behavior — this feature is wiring only.
- EPIC-1015's legacy-surface-cutover capability-parity decisions (multi-step
  temporal patterns, `measure`/`split_instances`, progressive tool
  availability, etc.) — those stay open/deferred, unaffected by this work.
- Production deployment or flipping these flags anywhere other than the
  workbench route's own composition.

---

*Implemented by: EPIC-0020*
