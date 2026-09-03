# T-0020-2: Auto-bind a completed screener run to the default results_table panel

**Epic**: EPIC-0020 (Wire the workbench composition root)
**Design**: docs/design/workbench-composition-root/
**Status**: Done
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

## Solution Approach

`runScreener.ts` gains a new optional dependency, `panelBinding`, on
`RunScreenerToolOptions`:

```ts
export interface PanelBindingDeps {
	kinds: PanelRegistry;
	sourceRenderer: SourceRendererRegistry;
	templates: LayoutTemplateRegistry;
}
```

(the three panel-only registries `PanelUseCaseDeps` needs besides
`workspaceId`/`repository`/`revisions`/`history`/`clock`/`ids` — all six of
those already live on `WorkbenchDeps`, which `execute()` already has.)

1. After a successful (non-refused) run and `runStore.putRun(outcome)`, if
   `panelBinding` was supplied, call a new private helper
   `bindRunToResultsPanel(deps, panelBinding, workspaceId, runId)`:
   - Re-reads the doc via `deps.repository.get(workspaceId)` (the same
     `workspaceId` `execute()` already resolved for this call — not
     `panelBinding`'s own fixed id, so this binds whichever workspace the
     run actually executed against).
   - Builds one `PanelUseCaseDeps` object from `deps`'s six shared fields
     plus `panelBinding`'s three registries.
   - `readPanelState(doc).panels.find((p) => p.kind === 'results_table')` —
     first found, by existing panel order (AC3).
   - If none found, return (AC2: run already succeeded and returned;
     nothing else to do).
   - Otherwise call `bindPanelSource(panelDeps, { context: { actor: 'agent' },
panelId: target.id, source: { type: 'screener_results', ref: { run_id: runId } } })`
     — the exact application function T-0020-2's AC1 names, so replacing an
     existing binding (AC4) and going through
     `commitPanelChange`/`RevisionService`/change-history (AC5) both come
     for free.
   - The whole call is wrapped in try/catch; any error (no active
     workspace, a rejected source, whatever) is swallowed, never surfacing
     as a `run_screener` failure or altering its already-built `result`
     (AC2's "best-effort, never a precondition").
2. `group.ts`'s `ScreenerToolDeps` gains an optional `panelBinding?:
PanelBindingDeps` field (mirroring `runStore`/`evaluationPort`'s own
   optional-injection style) and `buildScreenerTools` passes it through to
   `createRunScreenerTool`'s options.
3. `workbenchCompositionRoot.ts`'s `buildScreenerDeps` gains a second
   parameter, the panel runtime's own `PanelToolDeps` (already built first
   in `registerWorkbenchComposition`, and already carrying
   `kinds`/`sourceRenderer`/`templates`), and sets
   `panelBinding: { kinds, sourceRenderer, templates }` from it — no new
   instances, reusing exactly what T-0020-1 already built.
4. Tests (`runScreener.test.ts`, extending its existing harness): a run
   against a workspace with a seeded `results_table` panel ends with that
   panel's `source` resolving to the new run; a run against a workspace
   with no `results_table` panel still succeeds and returns a `run_id`
   (asserting the workspace's panel list is unaffected); a second run
   against an already-bound panel replaces the binding (asserts exactly one
   `source`, pointing at the new run, not two or a stale one).
