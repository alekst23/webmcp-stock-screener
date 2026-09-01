# T-0002-1: Unify action recording

**Epic**: EPIC-0002 (Unified Action Log)
**Design**: docs/design/pattern-research-workbench/
**Status**: Done
**Depends on**: —
**Blocks**: T-0002-2, T-0002-3
**Issue**: #2

## Description

`ChartToolbar.svelte` calls `engine.showTickerCharts()` and
`engine.clearPanels()` directly on the `ResearchEngine`, bypassing
`buildTools()`'s tool specs entirely — the only path that currently
appends to `activityStore` (via `register.ts`'s `recordActivity`
wrapper). This ticket gives both call sites — the agent's WebMCP tool
calls and any human-triggered UI control — one shared recording entry
point, and adds the `actor` distinction the log needs.

## User Story

As a human sharing a research session with an AI agent,
I want every action I take through the UI to be recorded the same way an
agent's tool call is,
so that the activity log is a complete record, not just an agent-only one.

## Acceptance Criteria

1. A shared recording function exists that both `register.ts`'s tool
   wrapper and `ChartToolbar.svelte` call to append an event — no call
   site writes to `activityStore` any other way.
2. `AgentActivityEvent` gains an `actor: 'human' | 'agent'` field, set
   statically per call site (tool-registration path = agent, direct
   UI-control path = human) — not runtime-detected.
3. Using the chart toolbar (e.g. "Show monthly," "Clear panels") appends
   an entry to the same log an agent's tool calls append to, in true
   chronological order relative to them.
4. A failed action (human or agent) appends an entry showing a readable
   failure reason, matching the existing `summarizeToolCall` error
   handling.
5. The `/dev` control surface is unchanged — it does not call the shared
   recording function and does not write to `activityStore`.

## Design References

- `docs/design/pattern-research-workbench/spec.md` — "Unified action log"
  and "Human actions are visible" scenarios (feature #9)
- `docs/design/pattern-research-workbench/technical.md` — `actor` field,
  shared recording entry point

## Solution Approach

The shared entry point lives in `src/lib/workspace/activity.ts` (the
module that already owns `activityStore` and `summarizeToolCall`), not as
a `ChartToolbar`-local wrapper — so both call sites depend on the same
module instead of one depending on the other.

- Add `export function recordAction(activity, actor, actionName, input,
  result: ToolResult): void` to `activity.ts`. It builds the
  `AgentActivityEvent` (id, actor, toolName, timestamp,
  `summarizeToolCall(actionName, result)`) and appends via
  `activity?.update(...)` — this replaces `register.ts`'s inline
  `recordActivity` closure and its local `nextActivityId` counter, which
  move into `activity.ts` as module state.
- `register.ts`'s `toDescriptor` calls `recordAction(activity, 'agent',
  spec.name, input, result)` directly in place of the old closure.
- Export `ok`/`fail` from `webmcp/tools.ts` (currently private) so
  `ChartToolbar.svelte` can build the same `ToolResult` shape
  `summarizeToolCall` expects, instead of duplicating that JSON-shaping
  logic.
- `ChartToolbar.svelte` gains an `activity: Writable<AgentActivityEvent[]>`
  prop (passed from `+page.svelte` as `activityStore`, mirroring how
  `store`/`engine` are already passed as props to sibling components, not
  imported as singletons). Each handler (`clearPanels`, `showMonthly`)
  wraps its existing try/catch: on success, `recordAction(activity,
  'human', 'clearPanels' | 'showTickerCharts', input, ok(returnValue))`;
  on failure, `recordAction(activity, 'human', ..., fail(message))` before
  the existing `error = ...` UI handling. Action names match the
  corresponding tool spec names in `tools.ts` (AC3's "same log... in true
  chronological order" implies the same action identity, not just the
  same list).
- `/dev/+page.svelte` is untouched — it already talks to
  `workspaceStore`/`engine` directly with no `activityStore` or
  `recordAction` reference (verified by inspection), so AC5 holds by
  construction, not by an explicit guard.

No domain contracts introduced — this is a TypeScript-only frontend
change to the existing `AgentActivityEvent` interface (see
`technical.md`, already documents the `actor` field and shared
entry-point requirement from epic design). No backend/Python layers are
touched.

**References:** `src/lib/workspace/activity.ts`, `src/lib/webmcp/register.ts`,
`src/lib/webmcp/tools.ts`, `src/lib/workspace/ChartToolbar.svelte`,
`src/routes/+page.svelte`.

## Out of Scope

Persistence (T-0002-2) and the timeline UI redesign (T-0002-3).
