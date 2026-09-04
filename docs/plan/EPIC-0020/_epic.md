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

| #   | Ticket    | Title                                                                             | Depends On          | Status |
| --- | --------- | ---------------------------------------------------------------------------------- | -------------------- | ------ |
| 1   | T-0020-1  | Shared composition root; flip WORKBENCH_TOOLS_ENABLED and SCREENER_TOOLS_ENABLED   | —                    | Done   |
| 2   | T-0020-2  | Auto-bind a completed screener run to the default results_table panel              | T-0020-1             | Done   |
| 3   | T-0020-3  | End-to-end integration test and architecture doc update                            | T-0020-1, T-0020-2   | Done   |
| 4   | T-0020-4  | Test the first-wins rule when multiple results_table panels exist                 | —                    | Done   |
| 5   | T-0020-5  | Negative test — other tool-group flags stay unregistered                          | —                    | Done   |
| 6   | T-0020-6  | De-duplicate FIXED_PROVENANCE; align the deps-split pattern across all 3 modules   | —                    | Done   |
| 7   | T-0020-7  | Add assertion messages to the composition root's identity test                    | —                    | Done   |
| 8   | T-0020-8  | Test idempotency-replay interaction with panel-binding                            | —                    | Done   |
| 9   | T-0020-9  | Guard against duplicate /workbench composition on remount                         | —                    | Done   |
| 10  | T-0020-10 | Auto-create the results_table panel when absent, and recycle it on every rerun    | —                    | Open   |
| 11  | T-0020-11 | Human-triggered "Run" action in the filter panel                                  | T-0020-10             | Open   |
| 12  | T-0020-12 | Disambiguate screener-revision vs. workspace-revision in the tool surface          | —                    | Open   |
| 13  | T-0020-13 | State the data as-of date on chart "no data" refusals                             | —                    | Open   |
| 14  | T-0020-14 | End-to-end integration test and doc update for the amended results-panel pipeline | T-0020-10, T-0020-11 | Open   |

Follow-up tickets 4-9 were filed by this epic's review (2026-09-02) and are
now Done (their status here was previously stale — corrected during the
tickets-10-14 design pass below, 2026-09-04).

Tickets 10-14 were added 2026-09-04 to fold in a change order observed live
against a running session: the results panel never appeared for a completed
run when none existed yet, there was no human-triggerable run action, screener
vs. workspace revision confusion, and unexplained chart "no data" refusals.
See `docs/design/workbench-composition-root/spec.md`'s Features 4-8 for the
full behavioral spec these tickets implement.

## Dependency Graph

```
T-0020-1 ──> T-0020-2 ──> T-0020-3

T-0020-10 ──> T-0020-11 ──> T-0020-14
T-0020-12 (independent)
T-0020-13 (independent)
```

The original three tickets are small and tightly coupled by design — each
only makes sense once the prior one exists, so they ran as three sequential
waves. Tickets 10-14 follow the same pattern for the create-if-absent/recycle
seam (10 → 11 → 14); 12 and 13 are independent of that seam and of each
other, and can run in parallel with it.

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
5. If no `results_table` panel exists, `run_screener` creates one (2x1) and
   binds it to the run (amended 2026-09-04, T-0020-10 — previously this
   silently no-oped); binding still never blocks the run itself from
   succeeding.
6. One integration test proves the full path end-to-end:
   `create_screener` → `set_screener_universe` → `edit_filter_tree` →
   `run_screener` → the `results_table` panel's bound source resolves to
   that run and its matches are readable through the panel's own read path.
7. `docs/architecture/new-webmcp-surface.md`'s "composition root — currently
   unowned" section is updated to record this epic as the resolution.
8. Full CI gate passes on the epic branch: typecheck, lint, format, frontend
   tests, backend tests (backend is untouched by this epic but must stay
   green), and a production build.
9. (Added 2026-09-04) A human can trigger the current screener's run directly
   from the filter panel and see the same results panel produced/recycled a
   `run_screener` tool call would produce (T-0020-11).
10. (Added 2026-09-04) Rerunning the same screener, by agent or human, always
    updates the same `results_table` panel in place — it never accumulates
    additional panels (T-0020-10).

## Known Limitation

*(Stale as of 2026-09-04 — corrected below.)* At the time this epic's original
three tickets landed, no real `ScreenerMarketData` adapter existed and
`run_screener` was refused with `empty_universe` against real data; this
epic's own tests substituted a fake evaluation port to prove the
composition-root wiring alone. EPIC-0025 (server-side screener evaluation
endpoint) subsequently shipped `HttpScreenerEvaluationPort`, which the live
composition root (`workbenchCompositionRoot.ts`'s `buildScreenerDeps`) now
uses in place of the in-browser fake — `run_screener` returns real matches
today, over the same backend `PanelPriceSeriesPort` charts also read from.

## Out of Scope

- Chart, similarity, backtest, alert, watchlist, and followup tool groups —
  their flags stay off.
- Choosing which panel to bind when more than one `results_table` panel
  exists through manual human creation — the first one found is bound (the
  "no panel exists yet" case is no longer out of scope — see T-0020-10).
- Any change to screener-core's own validation, matching, or ranking logic.
- EPIC-1015's legacy-surface-cutover work — untouched, still paused.
