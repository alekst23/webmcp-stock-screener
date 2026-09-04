# T-0020-10: Auto-create the results_table panel when absent, and recycle it on every rerun

**Epic:** EPIC-0020
**Status:** Done

## Goal

`bindRunToResultsPanel()` (`src/lib/webmcp/screener/runScreener.ts:169-199`) only
rebinds an *existing* `results_table` panel and silently no-ops if none exists. A
user asking an agent to run a screener on a workspace without one sees no results
anywhere — this was observed live (2026-09-04). The workspace has exactly one
current screener (`WorkspaceDocument.screenerId`), so this is not a multi-screener
targeting problem: it only needs create-if-absent, plus keeping the existing
same-panel-id rebind behavior working on every subsequent run so repeated runs
never create additional panels.

This amends `docs/plan/EPIC-0020/_epic.md`'s AC5 and its "Out of Scope" line about
panel binding — see `docs/design/workbench-composition-root/spec.md`'s "Create-if-absent
results panel" and "Recycled results panel" sections for the full behavioral spec.

## Acceptance criteria

- When a screener run completes successfully and the workspace has no
  `results_table` panel, one is created via the existing `createPanel()` path (2
  columns by 1 row rect) and bound to the new run in the same operation — the
  agent/human never has to call `create_panel` separately first.
- When a `results_table` panel already exists, behavior is unchanged from today:
  that panel (same panel id) is rebound — no new panel is created.
- Rerunning the same screener multiple times in a row never results in more than
  one `results_table` panel existing because of this path.
- `run_screener` still succeeds and returns its `run_id` even if panel
  creation/binding fails for any reason — binding stays best-effort, matching the
  epic's existing AC5 intent (only the "always no-ops when absent" half changes).
- A test proves the create-if-absent path: seed a workspace with zero
  `results_table` panels, run a screener, assert exactly one `results_table` panel
  now exists, is 2x1, and its source resolves to the new run.
- A test proves recycling: run the same screener twice, assert the panel id bound
  after the second run equals the panel id bound after the first (no second panel
  created), and its rows reflect the second run's matches.
- Mutation-checked: temporarily make the create-if-absent branch always create a
  new panel (never rebind an existing one) and confirm the recycling test fails.

## Solution Approach

Implements the "Create-if-absent results panel" and "Recycled results panel"
scenarios from `docs/design/workbench-composition-root/spec.md`. Wiring only —
no new domain contracts.

- `bindRunToResultsPanel()` in `src/lib/webmcp/screener/runScreener.ts:169-199`
  currently does `readPanelState(doc).panels.find(p => p.kind === 'results_table')`
  and returns early if `undefined`. Change the `undefined` branch to call
  `createPanel(panelDeps, { context: { actor: 'agent' }, kind: 'results_table',
  rect: { col: <auto>, row: <auto>, colSpan: 2, rowSpan: 1 } })` (see
  `src/lib/panels/application/createPanel.ts`'s `CreatePanelRequest` — `rect` is
  optional; per the confirmed UX decision, do NOT pass an explicit `col`/`row` and
  let `createPanel`'s own `resolveAutoRect` (`support.ts`) choose placement, only
  fixing `colSpan: 2, rowSpan: 1` as the requested footprint), then bind the new
  panel's id exactly as the existing-panel branch already does today.
- `panelDeps: PanelUseCaseDeps` is already constructed in this function for the
  bind call — `createPanel` takes the same `PanelUseCaseDeps` shape, so no new
  dependency wiring is needed, only calling `createPanel` before `bindPanelSource`
  when the find comes back empty.
- Preserve the existing best-effort contract for free: the call site
  (`runScreener.ts:309`) already wraps `bindRunToResultsPanel(...)` in a
  `try/catch` that `console.warn`s and never rethrows (AC2/AC5's existing
  "best-effort" comment). A `createPanel` failure (e.g. `grid_full`) thrown from
  inside the new create-then-bind branch is caught by that same existing
  try/catch — no new error handling needs to be added, only the new call inside
  the function it already wraps.
- No config vars, no new contracts, no mock stubs.

### Contracts to define

None — no new domain models or Protocols. This is new control flow inside an
existing function using an existing sibling use case (`createPanel`).

## Implementation Notes

`bindRunToResultsPanel()` (`src/lib/webmcp/screener/runScreener.ts`) now computes an
auto-placed 2x1 rect via `resolveAutoRect({ colSpan: 2, rowSpan: 1 },
visibleOccupied(state.panels))` (both re-exported from
`../../panels/application/support`) and passes that full `GridRect` to `createPanel()`
when no `results_table` panel is found, then binds the newly created panel's id
(`created.affectedIds[0]`) exactly as the existing-panel branch already did. The
existing-panel branch is unchanged apart from being folded into the same `targetId`
variable. Mutation-checked per the AC: temporarily forced the `if (existing)` branch to
`if (false && existing)` so the create path always ran, reran the suite, and confirmed
`test_runScreener_rerunAfterAutoCreate_recyclesSamePanelRatherThanCreatingAnother` (and
several sibling rebind tests) failed as expected, then reverted.
