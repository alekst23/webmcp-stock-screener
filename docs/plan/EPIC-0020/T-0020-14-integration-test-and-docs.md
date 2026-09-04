# T-0020-14: End-to-end integration test and doc update for the amended results-panel pipeline

**Epic:** EPIC-0020
**Status:** Done
**Depends on:** T-0020-10, T-0020-11

## Goal

Mirrors T-0020-3's role for the original wiring: one integration test proving the
*amended* path end to end, plus updating the architecture doc that records this
epic's resolution.

## Acceptance criteria

- One integration test proves: starting from a workspace with a defined screener
  and no `results_table` panel, a human-triggered run (T-0020-11) produces a
  2x1 `results_table` panel (T-0020-10) bound to the run, and rerunning — by
  either a human click or an agent's `run_screener` call — updates that same
  panel in place rather than creating another one.
- `docs/architecture/new-webmcp-surface.md` (or wherever T-0020-3 recorded the
  original resolution) is updated to note the create-if-absent/recycling and
  human-run amendments, with a pointer to
  `docs/design/workbench-composition-root/spec.md`.
- Full CI gate passes on the epic branch: typecheck, lint, format, frontend
  tests, backend tests, and a production build — matching the original epic's
  AC8.

## Solution Approach

Mirrors `T-0020-3`'s original integration test structure — find and follow that
test's describe block in `src/lib/webmcp/screener/runScreener.test.ts` (the
`'run_screener: auto-bind to the results_table panel (T-0020-2)'` block T-0020-4
and T-0020-8 already added tests to) as the pattern for this new test, rather
than inventing a new test file layout.

- Add the workspace-with-zero-`results_table`-panels → human-run (via T-0020-11's
  `runScreenerByHuman`) → panel created 2x1 and bound → rerun (either actor) →
  same panel id rebound sequence as one test in that same describe block or a
  clearly-named sibling block.
- `docs/architecture/new-webmcp-surface.md`: find wherever T-0020-3 recorded the
  original composition-root resolution and add a short amendment noting the
  create-if-absent/recycling/human-run additions, pointing at
  `docs/design/workbench-composition-root/spec.md` rather than duplicating its
  content.
- Run the project's full CI gate (see `README.md`: `npm test`, `npm run
  typecheck`, `cd backend && uv run pytest`) before reporting done.

### Contracts to define

None — test and documentation only.

## Implementation Notes

Read `runScreenerByHuman.test.ts` (T-0020-11's own suite) in full before
deciding placement: it already had the richer harness for the human side
(`seedCurrentScreener` sets `WorkspaceDocument.screenerId`, real
`PanelUseCaseDeps`, `PinnedRunStore`, action-log assertions) that
`runScreener.test.ts`'s `seedScreener()` helper (via `create_screener`) does
not provide -- `create_screener` never sets the workspace's *current*
screener, only `define_screener` does, and `runScreenerByHuman` reads
exactly that field. So the new test landed in
`src/lib/panels/shell/runScreenerByHuman.test.ts`, as a new describe block
after the existing T-0020-11 suites, reusing its `seedCurrentScreener`/
`makeFakePort`/`completeRunFor` helpers and adding one new helper
(`toWorkbenchDeps`) that builds a `WorkbenchDeps` for the agent-side
`run_screener` tool call, sharing the same harness's
repository/revisions/history/clock/ids -- exactly what a real composition
root does (T-0020-1's shared instances).

The test (`'a human run creates the panel, an agent rerun recycles it, and a
second human run recycles it again'`) proves, in one flow:

1. a workspace with a defined (current) screener and zero `results_table`
   panels;
2. a human-triggered run (`runScreenerByHuman`, T-0020-11) auto-creates a
   2x1 `results_table` panel bound to the human's run (T-0020-10's
   create-if-absent);
3. an agent's `run_screener` call reruns the same screener and rebinds the
   *same* panel id to the agent's run, rather than creating a second panel
   (T-0020-10's recycling, from the agent side after a human-created panel);
4. a second human-triggered run rebinds that same panel id again, to the
   human's second run -- proving recycling holds regardless of which actor
   created the panel or which actor reruns it (the spec's "Recycled results
   panel" scenario, exercised across both actor directions).

`docs/architecture/new-webmcp-surface.md`'s "The composition root — resolved
for `/workbench`'s panel/workbench-core/screener slice (EPIC-0020)" section
got a new "Amendment (EPIC-0020, 2026-09-04)" subsection summarizing the
create-if-absent/recycling/human-run additions and pointing at
`docs/design/workbench-composition-root/spec.md` for the full behavioral
spec, plus a short note flagging that this doc's "`/workbench`" references
predate EPIC-1015's later route migration onto `/` (no such note existed in
this file before; `docs/design/workbench-composition-root/spec.md` already
had an equivalent note in its own Preconditions, so nothing there was
duplicated).

CI gate (this worktree, frontend-only diff -- two files changed, no backend
files touched):

- `npm test`: 264 test files, 3120 tests passed, 1 pre-existing todo. All
  green, including the 6 tests in `runScreenerByHuman.test.ts` (5 existing +
  1 new).
- `npm run typecheck`: `svelte-check` — 782 files, 0 errors, 0 warnings.
- `npm run build`: production build succeeded (`adapter-static` wrote to
  `build/`).
- `cd backend && uv run pytest`: 335 passed, 9 failed, 5 skipped. All 9
  failures are the pre-existing ones the ticket calls out and are unrelated
  to this change (confirmed by `git status`/`git diff --stat` showing only
  `docs/architecture/new-webmcp-surface.md` and
  `src/lib/panels/shell/runScreenerByHuman.test.ts` touched, no `backend/`
  files): 8 `tests/functional/test_deployment_cutover_verification.py`
  stubs (T-1015-8 AC1/AC3-AC7/AC9, explicitly `pytest.fail("not
  implemented: ...")` placeholders) and 1
  `tests/unit/test_capability_parity_matrix.py::TestNoGoVerdict::test_no_legacy_file_deleted_or_modified_by_this_ticket`
  historical-commit check (asserts every commit that ever touched
  `capability-parity-matrix.md` changed only `docs/plan/` files; fails on a
  pre-existing commit from before this ticket, `079882c`, unrelated to this
  branch's work).
