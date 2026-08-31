# EPIC-1002: Unified Action Log

**Depends on**: —
**Blocks**: —
**Issue**: #2
**Design**: docs/design/pattern-research-workbench/

## Description

The shared workspace's activity feed is both incomplete and poorly
surfaced. Manual UI actions (the chart toolbar) bypass the tool-call
recording path entirely, so they never appear in the log. Separately, what
does get logged is barely surfaced — a bare count and flat list, sitting
next to a redundant raw state-snapshot dump with no ordering, actor, or
transactional feel. This epic gives the shared session one true,
persisted, actor-labeled transactional log of everything that happens in
it — human or agent — replacing the raw state dump as the way to see what
occurred.

## User Story

As a human sharing a research session with an AI agent (or a judge
observing one),
I want to see a single, trustworthy, ordered log of every action taken in
the session, labeled by who did it,
so that I can actually watch the agent (and my own actions) working,
instead of inferring history from a static end-state snapshot.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1002-1 | Unify action recording | — | Open |
| 2 | T-1002-2 | Persist the action log | T-1002-1 | Open |
| 3 | T-1002-3 | Timeline UI + remove raw state dump | T-1002-1 | Open |

## Dependency Graph

```
T-1002-1 ──┬──> T-1002-2
           └──> T-1002-3
```

## Wave Plan

- **Wave 1**: T-1002-1 — no dependencies
- **Wave 2** (parallel): T-1002-2, T-1002-3 — both depend on T-1002-1's shared recording entry point and `actor` field

## Acceptance Criteria

1. Every action that changes the shared session — a human interacting with
   a UI control, or an agent invoking a WebMCP tool — appends one entry to
   a single ordered log, labeled by actor ("Human" or "Agent"), action,
   result summary, and timestamp.
2. The `/dev` control surface does not write to this log (separate,
   disconnected developer tool).
3. Failed actions (human or agent) appear in the log with a readable
   failure reason, not silently dropped.
4. The log persists across page reloads in the same browser, matching the
   rest of workspace state's existing persistence behavior.
5. The raw current-state snapshot view is removed; the log is the sole
   visible record of session activity (panel/chart rendering elsewhere is
   unaffected).
6. The log is append-only — no editing, deleting, or reordering of
   entries.

## Design References

- `docs/design/pattern-research-workbench/spec.md` — feature #9 "Shared
  workspace & collaboration," updated by this epic
- `docs/design/pattern-research-workbench/technical.md` — new
  `AgentActivityEvent.actor` field and shared recording entry point

## Out of Scope

- Any change to the `/dev` control surface.
- Chart panel action-button redesign (tracked separately in #3 /
  EPIC-1003).
- Editing or deleting existing log entries.
