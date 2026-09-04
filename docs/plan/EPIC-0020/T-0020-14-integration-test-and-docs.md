# T-0020-14: End-to-end integration test and doc update for the amended results-panel pipeline

**Epic:** EPIC-0020
**Status:** Open
**Depends on:** T-0020-10, T-0020-11

## Goal

Mirrors T-0020-3's role for the original wiring: one integration test proving the
*amended* path end to end, plus updating the architecture doc that records this
epic's resolution.

## Acceptance criteria

- One integration test proves: starting from a workspace with a defined screener
  and no `results_table` panel, a human-triggered run (T-0020-11) produces a
  2x1 `results_table` panel (T-0020-10) bound to the run, and rerunning — by
  either a human click or an agent's `run_screener` call — updates that same
  panel in place rather than creating another one.
- `docs/architecture/new-webmcp-surface.md` (or wherever T-0020-3 recorded the
  original resolution) is updated to note the create-if-absent/recycling and
  human-run amendments, with a pointer to
  `docs/design/workbench-composition-root/spec.md`.
- Full CI gate passes on the epic branch: typecheck, lint, format, frontend
  tests, backend tests, and a production build — matching the original epic's
  AC8.
