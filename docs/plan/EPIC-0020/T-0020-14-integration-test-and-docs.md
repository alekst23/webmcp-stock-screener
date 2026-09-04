# T-0020-14: End-to-end integration test and doc update for the amended results-panel pipeline

**Epic:** EPIC-0020
**Status:** Open
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
