# T-0002-2: Persist the action log

**Epic**: EPIC-0002 (Unified Action Log)
**Design**: docs/design/pattern-research-workbench/
**Status**: Done
**Depends on**: T-0002-1
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

1. Logged actions (human and agent, per T-0002-1) persist to
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

Mirror `store.ts`'s `createWorkspaceStore` pattern exactly, applied to
`activityStore`'s own key — the log stays its own store, not folded into
`WorkspaceState` (spec explicitly keeps them separate; `WorkspaceState`
has no `activity` field and this ticket doesn't add one).

- `src/lib/workspace/activity.ts`: add `STORAGE_KEY =
  'webmcp-activity-log'` (parallel to `store.ts`'s
  `'webmcp-workspace-state'`).
- `createActivityStore()` gains an optional `storage?: Storage` param
  (default: real `localStorage` when defined, `undefined` otherwise —
  same fallback `store.ts` uses so tests can pass an isolated in-memory
  `Storage`). On init, read and `JSON.parse` any persisted array;
  corrupted/missing data falls back to `[]` (matches `store.ts`'s
  `readPersisted`'s try/catch — a bad slot must not crash the app on
  load, AC3). `store.subscribe(...)` writes the full array back on every
  update, same as `store.ts`.
- The module-level singleton `export const activityStore =
  createActivityStore();` stays a no-arg call — it now persists because
  the default `storage` argument resolves to real `localStorage`.
- `recordAction` (T-0002-1) is unaffected — it already only calls
  `activity.update(...)`, which now happens to trigger a `subscribe`
  write as a side effect of the store itself, not of the recording
  function.

No new domain contracts — `AgentActivityEvent`'s shape is unchanged
(T-0002-1 already added `actor`); this ticket only changes how the store
backing `activityStore` is constructed.

**References:** `src/lib/workspace/activity.ts`, `src/lib/workspace/store.ts`
(pattern to mirror).

## Out of Scope

Any change to what gets recorded (T-0002-1) or how the log is displayed
(T-0002-3).
