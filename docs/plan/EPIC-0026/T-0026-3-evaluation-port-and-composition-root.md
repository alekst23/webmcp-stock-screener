# T-0026-3: Evaluation port, result rows, retention, and composition root

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/screener-core/, docs/design/workbench-composition-root/
**Status**: Not started
**Depends on**: T-0026-1, T-0026-2
**Blocks**: —
**Resolves**: #26

## Description

The wiring ticket. Four changes, all in service of making the MVP loop
actually work end to end against real data with bounded memory:

1. An `HttpScreenerEvaluationPort` implementing the existing
   `ScreenerEvaluationPort` interface against EPIC-0025's
   `POST /screener/run`, wired as the composition root's default —
   replacing the honest-unavailable in-browser engine.
2. `ScreenerMatch` / `get_screener_results` rows extended to carry a full
   instrument reference (id, symbol, exchange, asset type, name), not
   just a bare `instrumentId` — required so a chart panel can be created
   directly from a result row without a second lookup.
3. `PinnedRunStore`'s default retention changed from `keepAllRuns` to
   evicting everything but the most recently pinned run (see epic notes).
4. The composition root (`workbenchCompositionRoot.ts`) registers exactly
   the MVP tool set — `search_catalog`, `define_screener`, `run_screener`,
   `get_screener_results`, `create_panel`, `get_canvas_state`,
   `remove_panel` — and removes everything else that's currently
   commented out, rather than leaving it commented. The in-browser
   screener engine is deleted if nothing but its own tests still
   reference it.

## User Story

As the MVP tool surface,
I want the real evaluation port wired in, results carrying enough detail
to act on, bounded run memory, and a composition root that reflects
exactly what's live,
so that the agent screener loop works end to end and the registered
surface stops silently drifting from what's documented.

## Acceptance Criteria

1. `run_screener` against a real screener definition returns real
   matches (via EPIC-0025's endpoint), not an `empty_universe` refusal.
2. The `evaluationPort` override seam (`WorkbenchCompositionOverrides`)
   still accepts a fake for tests, unchanged.
3. `get_screener_results` rows include `instrument_id`, `symbol`,
   `exchange`, `asset_type`, and `name`.
4. After a screener is run, redefined, and run again N times, only the
   most recently pinned run is queryable — an older `run_id` returns
   `reason: 'evicted'` from `get_screener_results`, not a growing set of
   live runs.
5. The composition root registers exactly the seven tools listed above
   (plus `set_panel_layout` if kept — decide at implementation time) and
   no others; every tool this MVP doesn't need is removed from the file,
   not left commented.
6. `docs/architecture/tool-surface-status.md` is updated to match the
   composition root's actual registered set.
7. If the in-browser screener engine has no caller left outside its own
   tests, it is deleted rather than left dead.

## Out of Scope

- Anything about the screener widget or drag-and-drop — EPIC-0027.
