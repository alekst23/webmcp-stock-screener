# T-1002-3: Timeline UI + remove raw state dump

**Epic**: EPIC-1002 (Unified Action Log)
**Design**: docs/design/pattern-research-workbench/
**Status**: Open
**Depends on**: T-1002-1
**Blocks**: —
**Issue**: #2

## Description

`ActivityFeed.svelte` currently renders a bare "Agent activity (N)"
heading and a flat, unstyled list. `WorkspaceView.svelte` separately
renders a redundant raw state snapshot (Studies/Setups/Instance sets/
Panels/Focus) with no relationship to the log. This ticket redesigns the
feed into an ordered, actor-labeled timeline and removes the raw snapshot
view — the log becomes the one place to see what happened in the session.

## User Story

As a human (or judge) watching a research session,
I want to see a clear, actor-labeled timeline of what happened,
so that I can tell at a glance who did what and when, without reading a
raw state dump.

## Acceptance Criteria

1. Each log entry visibly shows its actor as "Human" or "Agent" (per
   T-1002-1's `actor` field), the action, a human-readable summary, and a
   timestamp.
2. Entries render in true chronological order, interleaving human and
   agent actions correctly.
3. `WorkspaceView.svelte`'s raw Studies/Setups/Instance sets/Panels/Focus
   snapshot is removed from the page; no other panel/chart rendering is
   affected (grid/histogram/chart panels keep rendering exactly as they
   do today).
4. Resolves #2.

## Design References

- `docs/design/pattern-research-workbench/spec.md` — feature #9's revised
  description and behavioral rows
- `src/lib/workspace/ActivityFeed.svelte`, `src/lib/workspace/WorkspaceView.svelte`

## Solution Approach

Left to ticket design. Exact visual treatment (spacing, actor styling) is
open — this ticket is scoped to structure and correctness (actor label,
ordering, removal of the raw dump), not a full visual design pass.

## Out of Scope

Chart panel action-button redesign (tracked separately under #3 /
EPIC-1003). A full visual design system — this is a structural fix to the
log's presentation, not a styling overhaul.
