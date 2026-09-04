# EPIC-0027: Screener Widget and Drag-to-Chart

**Depends on**: EPIC-0026 (the widget reads `WorkspaceDocument.screenerId`
and the screener it points at, which `define_screener` maintains) — the
widget ticket can be built and tested against a fixture document
independently of EPIC-0026 landing first.
**Blocks**: —
**Design**: docs/design/screener-core/ (screener widget content),
docs/design/panel-system/ (drag-and-drop)
**Issue**: #27

## Description

Two independent pieces of UI, both scoped down from the original issue
during triage:

- **Seed layout was dropped entirely.** The issue proposed seeding a
  results panel alongside the screener widget; it turns out unnecessary —
  `run_screener`'s existing auto-bind already creates the results panel
  on first run if none exists, and the panel-system spec documents a
  deliberate, recent decision (the empty-grid-canvas hotfix) to keep a
  fresh workspace's seed minimal. The sequence (empty canvas → screener
  widget appears → results list appears on first run) already works with
  no seeding change.
- **The screener widget's content isn't a panel-system concern** — that
  spec explicitly disclaims panel contents as owned by the feature that
  owns the data. A read-only view of the current screener belongs to
  Screener Core, not Panel System.

What remains: give the `filter_builder` panel a real (read-only) body,
and let a human drag a result onto the canvas to create or bind a chart —
the one interaction the panel-system spec never covered (its only
drag-related non-goal is drag-to-*resize*, a different concept).

## User Story

As a human researching alongside the agent,
I want to see the screener's current settings on the canvas, and turn a
result into a chart by dragging it, without asking the agent every time,
so that the workbench is legible and usable directly, not just through
the agent.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-0027-1 | Read-only screener widget body | — | Not started |
| 2 | T-0027-2 | Drag a results row onto the canvas | — | Not started |

## Notes

- Both tickets reuse the exact use cases the agent-facing tools call
  (`createPanel`, `bindPanelSource`) for the drag path, so a human
  dragging a row and an agent calling `create_panel` can never produce
  different outcomes for the same intent.
