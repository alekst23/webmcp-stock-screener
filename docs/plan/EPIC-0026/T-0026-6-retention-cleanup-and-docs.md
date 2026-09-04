# T-0026-6: Run retention, dead-engine cleanup, and status doc

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/screener-core/, docs/architecture/tool-surface-mvp.md
**Status**: Done
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

## Solution Approach

**1. Retention.** `createPinnedRunStore` (`src/lib/screener/runStore.ts`)
already takes an injectable `RunRetentionPolicy` (`ports.ts`) and computes
each run's retention `index` (0 = most recently stored) before calling
`policy.shouldEvict`. The only change needed is the *default*: add a new
policy, `keepMostRecentRun`, next to the existing `keepAllRuns` in
`ports.ts` (`shouldEvict` returns `index > 0`), and swap `runStore.ts`'s
`options.policy ?? keepAllRuns` to `options.policy ?? keepMostRecentRun`.
No call site changes — every `createPinnedRunStore()` caller (`run_screener`,
`registerPanelTools.ts`, `registerAllFollowupTools.ts`,
`registerWatchlistTools.ts`) picks up the new default automatically, which
is exactly AC2's requirement. `keepAllRuns` stays exported/available:
`results/testSupport.ts`'s `testPinnedRunStore` explicitly opts into it
(a legitimate use — those tests seed several runs and read all of them
back), so it is not orphaned, just no longer the default.

**2. In-browser engine.** Grepped for every non-test importer of
`src/lib/screener/engine/*`. Only `src/lib/webmcp/screener/runScreener.ts`
imports from it (`createScreenerEngine`, `createUnavailableMarketData`),
and it does so as `createRunScreenerTool`'s own fallback default:
`options.evaluationPort ?? createScreenerEngine({ marketData, ... })`.
The live composition root (`workbenchCompositionRoot.ts`'s
`buildScreenerDeps`, T-0026-4) always supplies an explicit
`evaluationPort` (an override in tests, `HttpScreenerEvaluationPort`
otherwise), so this fallback never actually runs in the shipped app today.
But it is not test-only dead code: it is a real, reachable default on a
production module's public constructor (`createRunScreenerTool`, and
transitively `registerScreenerTools.ts`'s own `deps: ScreenerToolDeps =
createDefaultScreenerToolDeps()` default parameter), matching the
"honest-unavailability default when no real adapter is wired in" pattern
this codebase already uses for `marketData` elsewhere (see
`registerScreenerTools.ts`'s own comment on `createScreenerDeps`). Per
this ticket's own escape valve ("a documented fallback path"), the engine
is kept, not deleted — this note is that documentation. No individual file
under `engine/` (ranking.ts, universe.ts, tree.ts, conditionEvaluation*.ts)
is imported directly from outside the directory; they're only reachable
through `engine.ts`, which is itself only reachable through this one
fallback.

**3. Status doc.** Read `workbenchCompositionRoot.ts` end to end and cross-
checked each `register*` call against its own tool list
(`buildPanelTools`, `buildResultsTools`, `group.ts`'s `SCREENER_TOOL_NAMES`,
`registerCanvasStateTool`, `registerResolveTickerTool`,
`registerSearchCatalogTool`) to enumerate exactly what's live: 14 panel
tools + 2 results tools (`registerPanelTools`, unconditional) + 1
(`resolve_ticker`) + 1 (`search_catalog`) + 1 (`get_canvas_state`, narrowed
out of the full `registerWorkbenchTools` group) + 2
(`define_screener`/`run_screener`, narrowed out of the full
`registerScreenerTools` group) = 21 active tools. The rest of
workbench-core (8 tools) stays unregistered (not commented — the full
`registerWorkbenchTools()` call itself is simply never made from this
composition root); chart-authoring/similarity/follow-up-authoring stay
commented exactly as EPIC-1015 left them; watchlist/alerts/backtest/export
stay wired only to the disconnected `registerAllFollowupTools()` root, as
before.
