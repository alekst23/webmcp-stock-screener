# T-1015-1: Retirement inventory and audit

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Status**: Open
**Depends on**: —
**Blocks**: T-1015-2

## Description

Nothing can be deleted safely until someone has written down what
"legacy" actually means at file level. The legacy surface and the WebMCP
transport layer live side by side in the same directories, so deleting by
directory would take out working infrastructure the new surface still
needs. This ticket produces the single audited inventory every later
ticket in the epic works from.

No file is deleted or modified in this ticket. The deliverable is the
inventory itself.

## User Story

As the engineer executing the cutover,
I want one authoritative list saying what is retired, kept, and absorbed,
so that deletion is a mechanical step against a reviewed decision rather
than a judgement call made file by file under time pressure.

## Acceptance Criteria

1. Every source, test, component, route, and doc file that belongs to the
   legacy surface appears in the inventory exactly once.
2. Each entry is classified as **retire** (deleted in this epic), **keep**
   (infrastructure that survives and serves the new surface), or
   **absorb** (logic that moves into the new surface, with the old file
   deleted afterwards).
3. Each entry carries a one-line reason for its classification.
4. Each **absorb** entry names where the logic is going, or is downgraded
   to **retire** if nothing in the new surface needs it.
5. The inventory distinguishes product surface from transport
   infrastructure explicitly, and does not classify anything by
   directory alone.
6. Every file the inventory names is verified to exist at the recorded
   path; the inventory contains no speculative entries.
7. Files that are neither legacy nor new-surface (build config,
   deployment config, static assets, scripts) are called out as
   deliberately untouched rather than omitted.
8. The inventory is committed to the epic branch as a reviewable
   document.

## Design References

- `docs/design/pattern-research-workbench/technical.md` — records which
  contracts belong to product surface and which to the bridge/registration
  transport layer; the primary source for the keep/retire split.
- `docs/tools.md` — the legacy tool surface and its own "Code layout"
  section.
- The `_epic.md` files of EPIC-1006 through EPIC-1014 — what the new
  surface actually delivered, and therefore what "absorb" targets exist.

## Technical Considerations

The following starting classification was established during epic
authoring by reading the files. It is a **starting point to verify and
correct**, not a finished inventory — the sibling epics will have moved
things.

**Keep — WebMCP transport, not product surface.** These modules know
nothing about studies, setups, or instance sets except through an injected
engine and a tool-spec list:

- `src/lib/webmcp/bridge.ts` — the in-page `document.modelContext`
  polyfill and bridge-replacement notification. Pure transport.
- `src/lib/webmcp/register.ts` — desired-vs-registered diffing, generation
  ownership across remounts, dispose semantics. Transport, but it imports
  `buildTools` and `ResearchEngine` directly; that coupling has to be
  genericized rather than deleted.
- `src/lib/webmcp/session.ts` — the bridge connect/failure state machine.
- `src/lib/webmcp/status.ts` — status formatting for the header
  (`buildWebmcpStatus`, `formatBridgeStatus`, `formatAgentToolsContext`).
  Keep, but it is fed by the tool list and will need re-pointing.
- `src/lib/webmcp/testSupport.ts` and the `register`/`session`/`status`
  tests.
- The ambient WebMCP types currently inside `src/lib/webmcp/types.ts`
  (`ModelContext`, `ModelContextToolDescriptor`, `ToolResult`, `ToolSpec`)
  — these are transport and must be split out before the rest of that
  file is retired.

**Absorb — reusable logic inside retiring files:**

- `src/lib/workspace/visualization.ts` — `computeChartGeometry`,
  `axisTicks`, `axisTickIndices`, `nearestBarIndex`, `sliceBarsForRange`
  are pure chart math with no legacy-model coupling.
- `src/lib/workspace/activity.ts` — the action-log store and persistence;
  `summarizeToolCall` is legacy-tool-specific and is superseded by the new
  surface's `diff_summary` contract.
- `src/lib/workspace/snapshots.ts`, `snapshotGuard.ts` — superseded by
  `save_workspace` / `restore_workspace_revision` (see epic Open Question 3).
- `backend/infra/pandas_engine.py`, `backend/infra/expression.py`,
  `backend/domain/models/` — the computational core, plausibly reusable
  under the new screener. Decided in T-1015-4.

**Retire — product surface:**

- `src/lib/webmcp/tools.ts` and `tools.test.ts` — the 11 legacy tools.
- The legacy half of `src/lib/webmcp/types.ts` — `StudySummary`,
  `SetupSummary`, `InstanceEvent`, `InstanceSetSummary`, `PanelSummary`,
  `FocusState`, `WorkspaceState`, the per-tool `*Input` types,
  `ResearchEngine`, `FUNCTION_CATALOG`, `ExpressionError`.
- `src/lib/webmcp/spike.ts`, `spike.test.ts`, `src/routes/spike/`,
  `backend/api/routes/spike.py`, `backend/api/schemas/spike.py`,
  `backend/tests/functional/test_spike_ping.py` — T-0001-2 throwaway
  scaffolding. **Load-bearing caveat**: `render.yaml`'s
  `healthCheckPath` points at `/api/spike/ping`.
- `src/lib/webmcp/integration.test.ts` — couples `createApiEngine` to
  `buildTools`; both sides retire.
- `src/lib/workspace/store.ts`, `apiEngine.ts` and their tests — the
  legacy workspace model and its HTTP client.
- `src/lib/workspace/WorkspaceView.svelte`, `GridPanel.svelte`,
  `PriceChart.svelte`, `FocusChart.svelte`, `ChartToolbar.svelte`,
  `ActivityFeed.svelte`, `SnapshotPicker.svelte`.
- `src/routes/dev/+page.svelte` — the legacy manual tool harness.

## Out of Scope

Deleting or editing any of the inventoried files — later tickets do that.
Deciding whether a missing capability is acceptable — that is T-1015-2.
