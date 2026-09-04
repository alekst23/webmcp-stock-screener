# T-0027-1: Read-only screener widget body

**Epic**: EPIC-0027 (Screener Widget and Drag-to-Chart)
**Design**: docs/design/screener-core/
**Status**: Not started
**Depends on**: —
**Blocks**: —

## Description

`filter_builder` is a registered panel kind with no body — a placeholder.
This ticket gives it a real, read-only view of the workspace's current
screener (the one `WorkspaceDocument.screenerId` points at): universe,
conditions, ranking, and limit. It renders from the same document read
every other panel body already uses (`repository.get` + the existing
observer notify) — no new tool, no new read path.

## User Story

As a human watching the agent build a screener,
I want to see its current settings on the canvas as it's built,
so that I can verify what the agent did before it runs, without asking.

## Acceptance Criteria

1. With no current screener on the workspace, the panel shows an
   explicit empty state ("no screener yet" or equivalent) — never blank,
   never an error.
2. Once a screener exists, the panel renders its universe, filter tree
   summary, ranking, and limit.
3. When the agent redefines the screener (`define_screener`), the panel's
   content updates on the next observer notify — no manual refresh, no
   stale content.
4. The panel exposes no controls that mutate the screener — it is a
   mirror of agent-driven state, not an editor, for this ticket.

## Out of Scope

- Any input control that lets a human edit the screener definition
  directly through this view — explicitly deferred; redefinition stays
  agent-driven only for MVP.
