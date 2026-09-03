# T-0020-3: End-to-end integration test and architecture doc update

**Epic**: EPIC-0020 (Wire the workbench composition root)
**Design**: docs/design/workbench-composition-root/
**Status**: Done
**Depends on**: T-0020-1, T-0020-2
**Resolves #20**

## Description

The wiring and the auto-bind exist after T-0020-1/T-0020-2, but no test
proves the full path an agent would actually exercise, and the
architecture doc that has named this gap since 2026-09-01 still calls it
"currently unowned." This ticket closes both: one integration test through
the real composition root, and the doc update that lets the next reader of
`docs/architecture/new-webmcp-surface.md` know it's resolved.

## Acceptance Criteria

1. One new integration test exercises, through `/workbench`'s actual shared
   composition root (not hand-built fixtures): `create_screener` →
   `set_screener_universe` → `edit_filter_tree` → `run_screener`, then
   confirms the `results_table` panel's bound source resolves to that run
   and its matches are readable through the panel's own existing read path
   (e.g. `get_screener_results` or the panel kind's own accessor).
2. The test lives in a location and tier consistent with the project's test
   structure for cross-module flows (`tests/functional/` or equivalent
   frontend integration location — match the existing convention for
   multi-module flows in this codebase, e.g. `resultsTools.e2e.test.ts`'s
   location and naming).
3. `docs/architecture/new-webmcp-surface.md`'s "The composition root —
   currently unowned" section is updated: state that `/workbench` now has
   one, name EPIC-0020, and correct any text that still describes the gap
   as open.
4. `docs/plan/project.md` is **not** edited by this ticket — the
   orchestrator updates the plan file after the epic closes.
5. Full CI gate passes: typecheck, lint, format, frontend tests, backend
   tests, production build.

## Design References

- `docs/design/workbench-composition-root/spec.md` — full spec, all three
  features are exercised by this ticket's test.
- `src/lib/results/tools/resultsTools.e2e.test.ts` — closest existing
  precedent for a cross-module integration test in this codebase; follow
  its structure rather than inventing a new pattern.
- `docs/architecture/new-webmcp-surface.md` — the doc section to correct.

## Out of Scope

- Any new application code — T-0020-1 and T-0020-2 own all behavior; this
  ticket only tests and documents it.

## Solution Approach

New test file: `src/lib/workbench/composition/workbenchCompositionRoot.e2e.test.ts`
(alongside `workbenchCompositionRoot.ts`/`.test.ts`, mirroring
`resultsTools.e2e.test.ts`'s sibling-of-the-module-under-test location and
`*.e2e.test.ts` naming).

**Finding during implementation**: driving the four-step sequence through
`registerWorkbenchComposition()` exactly as shipped always returns a
`refused` run, never `complete`. Root cause, confirmed by inspecting the
refusal payload: `unavailableMarketData.ts`'s `resolveUniverse()` resolves
(does not throw) to `[]`, so `screenerValidation.ts`'s
`resolveUniverseSize` reports `{ resolvable: true, count: 0 }` — read by
its own existing rule as a genuine (not merely unresolvable) empty
universe, which is unconditionally a _blocking_ problem regardless of
filter tree or universe criteria. This is screener-core's own existing,
unchanged validation behavior (not something this epic's tickets touched),
and no real `ScreenerMarketData` adapter exists anywhere in this codebase
yet (every other screener test — `runScreener.test.ts`, `engine.test.ts`
— already fakes this exact port for the same reason). Changing that
validation rule is explicitly out of scope for this epic.

Given that, the test builds its harness from T-0020-1/T-0020-2's own
exported composition-root functions directly —
`createWorkbenchSharedInfra`, `createPanelShellRuntime`,
`buildWorkbenchDeps`, `buildScreenerDeps`, and the real
`registerPanelTools`/`registerWorkbenchTools`/`registerScreenerTools` —
proven equivalent to calling `registerWorkbenchComposition()` itself by
`workbenchCompositionRoot.test.ts`'s own identity assertions. The one
substitution is `ScreenerToolDeps.evaluationPort` (an existing, already
-injectable field on the type T-0020-1 itself builds) — a fake port
producing a `complete` `ScreenerRun`, matching `runScreener.test.ts`'s
`makeFakePort` convention exactly. Every other piece of the composition
(shared repository/revisions/history/idempotency, panel registries, the
real `bindPanelSource` call T-0020-2 added, the real `get_canvas_state`/
`get_screener_results` read paths) is exercised unmodified.

Test asserts, in the "happy path" test: `create_screener` →
`set_screener_universe` → `edit_filter_tree` → `run_screener` succeeds
with `status: 'complete'` and a `run_id`; `get_canvas_state`'s
`results_table` panel entry has `boundResourceId` equal to that `run_id`
(the field `panelState.ts`'s existing `PanelRecord` projection uses for a
panel's source — a "best-effort display convenience", per that module's
own comment, not the full `PanelSourceRef`); and `get_screener_results`
against that panel's id reads back the same `run_id` and the fixture's one
match. A second test proves AC2/AC5 (best-effort, no-panel case) by
removing the seeded `results_table` panel first, then confirming
`run_screener` still succeeds and returns a `run_id`.

`docs/architecture/new-webmcp-surface.md`'s "composition root — currently
unowned" section is corrected to name EPIC-0020 as the resolution, per
AC3.
