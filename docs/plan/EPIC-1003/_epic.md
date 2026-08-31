# EPIC-1003: Panel Action Set

**Depends on**: —
**Blocks**: —
**Issue**: #3
**Design**: docs/design/pattern-research-workbench/

## Description

`HistogramPanel` isn't part of the panel system at all — it loops
separately over every instance set in the workspace, rendering an
identical, unlabeled "Show histogram (10d forward return)" toggle per
set, disconnected from whichever grid panel actually represents that
instance set. This epic gives each grid panel a small, standard set of
actions scoped to itself — a histogram toggle for its own instance set,
and the ability to close just that panel — replacing the bolted-on
button list with a real designed interaction.

## User Story

As a user viewing chart panels in the shared research session,
I want each panel's actions (view its histogram, close it) attached
directly to that panel,
so that I can tell at a glance which action applies to which result set,
instead of hunting through a disconnected list of identical buttons.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1003-1 | Panel-scoped histogram action | — | Done |
| 2 | T-1003-2 | Individual panel close | — | Done |
| 3 | T-1003-3 | Add removePanel persistence round-trip test | — | Open |
| 4 | T-1003-4 | Panel action polish — a11y, stuck-panel close, focus-state sync | — | Open |

## Dependency Graph

```
T-1003-1 (independent)
T-1003-2 (independent)
```

## Wave Plan

- **Wave 1** (parallel): T-1003-1, T-1003-2 — independent actions, both
  touch `GridPanel.svelte` (mergeable conflict risk, not a real
  dependency)

## Acceptance Criteria

1. Each grid panel tied to an instance set exposes a histogram toggle
   scoped to that panel's own instance set — visibly attached to the
   panel, not a separate disconnected control elsewhere on the page.
2. The standalone per-instance-set histogram button list is removed.
3. Each panel can be closed/removed individually without affecting other
   open panels.
4. "Clear panels" (removes all panels) continues to work unchanged.
5. Resolves #3.

## Design References

- `docs/design/pattern-research-workbench/spec.md` — feature #7 "Grid
  visualization," updated by this epic

## Out of Scope

- New panel kinds beyond grid + its histogram toggle.
- Reordering, resizing, or any chart interactivity beyond existing
  selection/zoom.
- The activity log redesign (tracked separately in #2 / EPIC-1002).
