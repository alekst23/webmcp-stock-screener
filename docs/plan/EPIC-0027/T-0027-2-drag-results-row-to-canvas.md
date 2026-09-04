# T-0027-2: Drag a results row onto the canvas

**Epic**: EPIC-0027 (Screener Widget and Drag-to-Chart)
**Design**: docs/design/panel-system/
**Status**: Not started
**Depends on**: —
**Blocks**: —
**Resolves**: #27

## Description

Lets a human drag a row from the results table directly onto the canvas
to create or bind a chart, without going through the agent. Every
behavioral branch reuses an existing, already-specified panel-system rule
rather than introducing a new one:

- Drop on an empty grid cell → creates a chart panel there (`create_panel`,
  same use case an agent's tool call uses), at the exact cell dropped on
  — not wherever auto-placement would otherwise choose.
- Drop on an existing chart panel, bound or unbound → rebinds its source
  (`bind_panel_source`'s existing "bind or rebind" semantics — nothing
  new).
- Drop on a panel/renderer that doesn't accept an instrument source →
  rejected via the existing source-type validation `bind_panel_source`
  already enforces.
- Drop when no empty cell exists → rejected via the existing "grid is
  full" case already in the panel-system spec's layout behavior.

## User Story

As a human browsing screener results,
I want to drag a row onto the canvas to see it as a chart,
so that turning a result into a chart doesn't require asking the agent.

## Acceptance Criteria

1. Dropping a results row on an empty grid cell creates a chart panel at
   that exact cell, bound to that row's instrument.
2. Dropping a results row on an existing chart panel (whether empty or
   already bound to a different instrument) rebinds that panel's source
   to the dropped instrument; no new panel is created.
3. Dropping on a panel kind/renderer that doesn't accept an instrument
   source is rejected — shown as a not-allowed drop target — and changes
   nothing.
4. Dropping when the grid has no empty cell is rejected with the same
   semantics as the existing agent-facing "grid is full" case.
5. The resulting panel/binding is indistinguishable from one produced by
   the equivalent agent tool call (`create_panel` / `bind_panel_source`) —
   same use case, same mutation shape.

## Out of Scope

- Dragging multiple selected rows at once — "make charts from the top 5"
  stays a text/agent path for MVP.
- Drag-to-resize or any other drag gesture — already a panel-system
  non-goal, unrelated to this ticket.
