# T-1002-2: Persist the action log

**Epic**: EPIC-1002 (Unified Action Log)
**Design**: docs/design/pattern-research-workbench/
**Status**: Open
**Depends on**: T-1002-1
**Blocks**: —
**Issue**: #2

## Description

`activityStore` currently lives only in memory — reloading the page loses
the entire log, unlike the rest of workspace state (studies, setups,
instance sets, panels, focus), which already persists to `localStorage`
via `store.ts`. This ticket brings the log's persistence behavior in line
with the rest of the workspace.

## User Story

As a human (or judge) watching a research session,
I want the action log to survive a page reload,
so that I don't lose the transactional history I was just watching.

## Acceptance Criteria

1. Logged actions (human and agent, per T-1002-1) persist to
   `localStorage` under their own key, following the same pattern
   `store.ts` already uses for workspace state.
2. Reloading the page in the same browser restores the full log as it
   was, in the same order.
3. A fresh browser (no existing key) starts with an empty log, matching
   current first-load behavior.

## Design References

- `docs/design/pattern-research-workbench/spec.md` — "Log persists across
  reloads" scenario (feature #9)
- `src/lib/workspace/store.ts` — existing workspace-state persistence
  pattern to follow

## Solution Approach

Left to ticket design — likely mirrors `store.ts`'s
read-on-init/write-on-update pattern applied to `activityStore` via a new
`localStorage` key, rather than folding activity events into
`WorkspaceState` itself (spec explicitly keeps the log its own store).

## Out of Scope

Any change to what gets recorded (T-1002-1) or how the log is displayed
(T-1002-3).
