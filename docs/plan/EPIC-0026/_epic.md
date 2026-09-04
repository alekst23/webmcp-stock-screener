# EPIC-0026: Agent Screener Loop

**Depends on**: EPIC-1006 (workspace/revision contract), EPIC-1008
(catalog registry). Consumes EPIC-0025's `POST /screener/run` contract for
the real evaluation port — independently testable via the existing
`evaluationPort` override seam with a fake, so this epic does not block
on EPIC-0025 landing first.
**Blocks**: EPIC-0027 (the screener widget reads the workspace's current
screener, which this epic's `define_screener` maintains)
**Design**: docs/design/screener-core/
**Issue**: #26

## Description

Today's screener tool surface is either commented out entirely
(`workbenchCompositionRoot.ts`) or, where it exists, split across five
sequential mutation tools (`create_screener`, `set_screener_universe`,
`edit_filter_tree`, `set_screener_ranking`, `validate_screener`) — a
screener half-built across four calls has intermediate states a run
could observe, and four round-trips for one sentence of user intent is
where correctness goes to die.

This epic replaces that boundary with one atomic, fully-validated
`define_screener` call; registers the vocabulary lookup
(`search_catalog`) an agent needs so it never guesses a catalog id; wires
the real evaluation port against EPIC-0025's endpoint; and registers
exactly the MVP tool surface in the composition root, removing (not
commenting) everything else.

## User Story

As an agent building a screener on behalf of a user,
I want to define a complete screener in one call, look up the engine's
vocabulary when I'm not sure of an id, and get results with enough detail
to act on directly,
so that "find energy sector stocks with the highest gains in the past 48
hours" is a small, fully-validated number of tool calls, not a fragile
sequence.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-0026-1 | `define_screener` tool | — | Not started |
| 2 | T-0026-2 | `search_catalog` registration + sector enumeration | — | Not started |
| 3 | T-0026-3 | Evaluation port, result rows, retention, composition root | T-0026-1, T-0026-2 | Not started |

## Notes

- `WorkspaceDocument.screenerId` already exists (EPIC-1006) but has never
  been written by any tool. `define_screener` is what starts using it, as
  the workspace's "current screener" pointer — the agent doesn't track or
  pass an id for the common case; an explicit `screener_id` only matters
  for a second, concurrent screener, which no tool surfaces a picker for.
- Run retention changes from "keep every run for the life of the session"
  (the current default, `keepAllRuns`) to "keep only the most recently
  pinned run." Only one panel is ever bound to a run in this surface, so
  older runs serve nothing — re-running a screener after a dozen tweaks
  should not accumulate a dozen full match lists in memory.
