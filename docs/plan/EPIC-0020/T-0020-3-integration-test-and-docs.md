# T-0020-3: End-to-end integration test and architecture doc update

**Epic**: EPIC-0020 (Wire the workbench composition root)
**Design**: docs/design/workbench-composition-root/
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
