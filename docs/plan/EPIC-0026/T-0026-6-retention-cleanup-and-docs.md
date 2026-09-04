# T-0026-6: Run retention, dead-engine cleanup, and status doc

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/screener-core/, docs/architecture/tool-surface-mvp.md
**Status**: Not started
**Depends on**: T-0026-5
**Blocks**: —
**Resolves**: #26

## Description

_Split out of the original T-0026-3 — see that ticket's note. This is the
last of the four pieces: memory-bounding, dead-code cleanup, and the
documentation update, done last because it needs T-0026-5's final
registered set to know what's actually still referenced._

Three independent, small changes:

1. `PinnedRunStore`'s default retention is currently `keepAllRuns` — every
   run pinned for the life of the session stays in memory. Only one panel
   is ever bound to a run in this surface, so older runs serve nothing.
   Change the default to evicting everything but the most recently pinned
   run.
2. If the in-browser screener engine (`src/lib/screener/engine/`,
   `unavailableMarketData.ts`) has no caller left outside its own test
   files after T-0026-4/T-0026-5 land, delete it. If something legitimate
   still references it (e.g. a documented fallback path), leave it and
   say why in this ticket's implementation notes instead.
3. Update `docs/architecture/tool-surface-status.md` to match the
   composition root's actual registered set after T-0026-5.

## User Story

As the MVP tool surface,
I want bounded run memory and no dead code or stale docs left behind by
this epic,
so that re-running a screener repeatedly doesn't accumulate memory, and
the next person reading the architecture docs sees what's actually true.

## Acceptance Criteria

1. After a screener is run, redefined, and run again N times, only the
   most recently pinned run is queryable — an older `run_id` returns
   `reason: 'evicted'` from `get_screener_results`, not a growing set of
   live runs.
2. The retention change is a `PinnedRunStore` construction default, not a
   special case in `run_screener` — any caller creating a store without an
   explicit policy gets the new default.
3. The in-browser screener engine is deleted if orphaned, or explicitly
   kept with a documented reason — not left in an undecided, silently dead
   state.
4. `docs/architecture/tool-surface-status.md` lists exactly the tools
   `workbenchCompositionRoot.ts` registers as of T-0026-5, with no
   overclaiming (a tool that exists as code but isn't registered is not
   "available").
5. `npm run typecheck` and the full frontend suite are clean.

## Out of Scope

- Any further change to what's registered — that's final as of T-0026-5.
