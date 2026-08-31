# T-1002-1: Unify action recording

**Epic**: EPIC-1002 (Unified Action Log)
**Design**: docs/design/pattern-research-workbench/
**Status**: Open
**Depends on**: —
**Blocks**: T-1002-2, T-1002-3
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

Left to ticket design — the entry point could live in `activity.ts`
itself (a function both `register.ts` and `ChartToolbar.svelte` import)
or as a thin wrapper `ChartToolbar.svelte` calls before/after each
`engine.*()` call. Either way, `register.ts`'s existing
`recordActivity`/`summarizeToolCall` logic should be reused, not
duplicated.

## Out of Scope

Persistence (T-1002-2) and the timeline UI redesign (T-1002-3).
