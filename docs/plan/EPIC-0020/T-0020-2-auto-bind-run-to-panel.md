# T-0020-2: Auto-bind a completed screener run to the default results_table panel

**Epic**: EPIC-0020 (Wire the workbench composition root)
**Design**: docs/design/workbench-composition-root/
**Depends on**: T-0020-1
**Blocks**: T-0020-3

## Description

With T-0020-1's shared `PinnedRunStore` in place, a screener run is
storable and readable by any tool group — but nothing yet points a
`results_table` panel at a freshly completed run. Per the resolved design
decision (user, 2026-09-02: auto-bind for MVP simplicity over requiring an
explicit `bind_panel_source` call), this ticket makes a completed run
visible in the workspace's results panel with no separate step from the
agent.

## Acceptance Criteria

1. When `run_screener` completes successfully, the first `results_table`
   panel found in the workspace's current panel list has its source bound
   to the new run's `run_id` — using the existing `bind_panel_source`
   application logic (`src/lib/panels/application/bindPanelSource.ts`) or
   an equivalent internal call, not a parallel/duplicate binding path.
2. If the workspace has no `results_table` panel (e.g. the seeded one was
   closed), `run_screener` still succeeds and returns its `run_id`; binding
   is best-effort and never a precondition for the run's own success.
3. If the workspace has more than one `results_table` panel, only the first
   one found (by the workspace's existing panel ordering) is bound — no
   attempt to bind all of them or to disambiguate further (see epic
   Out-of-Scope).
4. A prior binding on the same panel (e.g. to an earlier run) is replaced,
   not appended to or left stale.
5. The bind itself goes through the same mutation/revision path every other
   workspace mutation does (per EPIC-1006's common contract) — it is not a
   side channel that bypasses `expected_revision`/idempotency/change-history
   recording.
6. Tests: a run against a workspace with a seeded `results_table` panel
   ends with that panel's source resolving to the new run; a run against a
   workspace with no `results_table` panel still succeeds and returns a
   `run_id`; a second run against an already-bound panel replaces the
   binding rather than erroring or duplicating it.
7. Full CI gate passes.

## Design References

- `docs/design/workbench-composition-root/spec.md` — "Automatic run-to-panel
  binding" behavioral scenarios.
- `src/lib/panels/application/bindPanelSource.ts` — the existing bind
  operation to reuse.
- `src/lib/webmcp/screener/runScreener.ts` — `createRunScreenerTool`, where
  the post-success hook most likely belongs.
- `src/lib/panels/domain/panel.ts` — how to enumerate a workspace's current
  panels and identify `results_table` ones.

## Out of Scope

- Choosing which panel to bind when more than one `results_table` panel
  exists — first-found only.
- The end-to-end integration test (T-0020-3) — this ticket's own tests
  cover the bind operation itself, not the full multi-step tool-call chain.
