# EPIC-0020: Wire the workbench composition root for a minimal live screener demo

**Depends on**: EPIC-1006, EPIC-1007, EPIC-1009 (all merged to `main`)
**Blocks**: —
**Design**: docs/design/workbench-composition-root/

## Description

`/workbench` renders its panel grid correctly, but nothing can fill it with
real data yet: `SCREENER_TOOLS_ENABLED` and `WORKBENCH_TOOLS_ENABLED` are
hardcoded `false`, and — this is the part flipping the flags alone doesn't
fix — every tool group builds its own independent `WorkspaceRepository` and
`PinnedRunStore`, so even with both flags on, a `run_screener` call has no
path to the panel that's supposed to render its results. This epic builds
the one thing no prior epic owned: a shared composition root for
`/workbench` that lets tool groups actually talk to each other, flips the
two flags, and wires a completed screener run automatically into the
workspace's results panel — the first real, live, end-to-end demonstration
of the new WebMCP surface.

Resolves #20.

## User Story

As an agent operating on `/workbench`,
I want to define and run a screener and see its matches appear in the
results panel without a human wiring anything by hand,
so that the new tool surface is not just built and tested in isolation but
actually usable end-to-end.

## Ticket Summary

| #   | Ticket   | Title                                                                            | Depends On         | Status |
| --- | -------- | -------------------------------------------------------------------------------- | ------------------ | ------ |
| 1   | T-0020-1 | Shared composition root; flip WORKBENCH_TOOLS_ENABLED and SCREENER_TOOLS_ENABLED | —                  | Done   |
| 2   | T-0020-2 | Auto-bind a completed screener run to the default results_table panel            | T-0020-1           | Done   |
| 3   | T-0020-3 | End-to-end integration test and architecture doc update                          | T-0020-1, T-0020-2 | Done   |

## Dependency Graph

```
T-0020-1 ──> T-0020-2 ──> T-0020-3
```

Small and tightly coupled by design — each ticket only makes sense once the
prior one exists, so this epic runs as three sequential waves of one ticket
each rather than a parallel fan-out.

## Acceptance Criteria

1. `/workbench` constructs exactly one `WorkspaceRepository`, ID sequencer,
   idempotency cache, revision service, change history, and `PinnedRunStore`;
   every tool group registered there (panel tools, workbench-core tools,
   screener tools) is built against those shared instances.
2. `WORKBENCH_TOOLS_ENABLED` and `SCREENER_TOOLS_ENABLED` are `true` for
   `/workbench`. Every other tool-group flag (chart, similarity, backtest,
   alerts, watchlist, followup) stays `false`.
3. An agent can call `create_screener` → `set_screener_universe` →
   `edit_filter_tree` → `run_screener` and get back a pinned `run_id`
   computed against the same workspace state the panel grid reads.
4. When a screener run completes successfully, the workspace's
   `results_table` panel is automatically bound to that run — no separate
   `bind_panel_source` call needed — and its rendered rows reflect the run's
   matches.
5. If no `results_table` panel exists, `run_screener` still succeeds;
   binding is best-effort and never blocks the run itself.
6. One integration test proves the full path end-to-end:
   `create_screener` → `set_screener_universe` → `edit_filter_tree` →
   `run_screener` → the `results_table` panel's bound source resolves to
   that run and its matches are readable through the panel's own read path.
7. `docs/architecture/new-webmcp-surface.md`'s "composition root — currently
   unowned" section is updated to record this epic as the resolution.
8. Full CI gate passes on the epic branch: typecheck, lint, format, frontend
   tests, backend tests (backend is untouched by this epic but must stay
   green), and a production build.

## Known Limitation

Because no real `ScreenerMarketData` adapter exists yet anywhere in this
codebase, a live `run_screener` call today is refused (`empty_universe`)
rather than returning real matches. This epic's own tests substitute a fake
evaluation port to prove the composition-root wiring is correct — they do
not and cannot demonstrate real market data flowing through yet. A real
adapter is a separate, future piece of work.

## Out of Scope

- Chart, similarity, backtest, alert, watchlist, and followup tool groups —
  their flags stay off.
- Choosing which panel to bind when more than one `results_table` panel
  exists — the first one found is bound.
- Any change to screener-core's own validation, matching, or ranking logic.
- EPIC-1015's legacy-surface-cutover work — untouched, still paused.
