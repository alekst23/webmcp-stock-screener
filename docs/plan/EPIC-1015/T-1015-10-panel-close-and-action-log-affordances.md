# T-1015-10: Restore panel-close and action-log UI affordances

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Design**: docs/design/legacy-surface-cutover/
**Status**: Open
**Depends on**: T-1015-9
**Blocks**: T-1015-6

## Description

Two small, human-facing affordances the legacy page had are missing
from the new surface: a way for a human to close a panel by clicking
something (the agent-side remove-panel action already exists — there's
just no button), and a visible, human/agent-attributed action log (the
legacy page showed one at the bottom of the screen; the new surface's
history model has no attribution field and no UI component at all).
This ticket restores both, scoped down from the legacy page's
always-visible log to a compact header icon that expands to show it —
per the user's own direction, not a full-page section.

## User Story

As a person using the app,
I want to close a panel by hand and see what's happened in my workspace
— including what an agent did versus what I did —
so that I'm not limited to what an agent chooses to do, and I can tell
the two apart.

## Acceptance Criteria

1. Every panel frame has a human-clickable close affordance that removes
   the panel, with the same effect as the agent-side remove-panel
   action.
2. The action-log entry shape gains an `actor: 'human' | 'agent'`
   attribution field, populated for every new entry recorded from this
   point forward.
3. The shell (T-1015-9) has a compact icon that expands into the log —
   not an always-visible section — showing every recorded action with
   its actor.
4. Closing a panel a human didn't create (e.g. one an agent created)
   works the same way as closing one a human created.
5. A production build succeeds and both affordances work with no console
   errors, verified via browser check.

## Design References

- `docs/design/legacy-surface-cutover/spec.md` — "Route migration"
  scenarios: "Panel close", "Action log access".
- `docs/design/legacy-surface-cutover/technical.md` — the action-log
  entry's `actor` field shape.
- `docs/design/pattern-research-workbench/technical.md` — how the legacy
  page's activity log and its human/agent attribution worked, for
  reference (retired, not reused as code).

## Out of Scope

Historical backfill of attribution on any log entries recorded before
this ticket lands. A general-purpose audit/history system beyond this
one attribution field. Building the shell itself (T-1015-9).
