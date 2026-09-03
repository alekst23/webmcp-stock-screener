# T-0020-4: Test the first-wins rule when multiple results_table panels exist

**Epic:** EPIC-0020
**Status:** Done

## Solution Approach

Added `test_runScreener_twoResultsTablePanels_bindsOnlyTheFirstOne` to
`runScreener.test.ts`'s `'run_screener: auto-bind to the results_table
panel (T-0020-2)'` describe block (the block that already builds real
panel registries so `bindPanelSource`'s own `validateSource` path runs).
Seeds two `results_table` panels with explicit non-overlapping rects (so
workspace panel order is deterministic — `createPanel`'s own auto-rect
placement is not relied on), runs a screener, then reads both panels'
`source` back off the workspace document: the first panel's source must
equal `{ type: 'screener_results', ref: { run_id } }` and the second's
must stay `null` (a freshly created panel's default, unrequested source).

Mutation-checked per this codebase's convention: temporarily changed
`bindRunToResultsPanel`'s `Array.find()` to bind the *last* matching panel
instead of the first, confirmed the new test fails
(`expected null to deeply equal { type: 'screener_results', ... }` on the
first panel's source), then reverted.

## Goal

The spec's "Multiple results panels present" scenario (first `results_table`
panel found, by workspace panel order, is bound) is implemented correctly by
construction (`Array.find()`), but no test seeds two `results_table` panels
in one workspace and asserts only the first receives the binding while the
second is left untouched. Found by EPIC-0020's epic review (2026-09-02).

## Acceptance criteria

- A test seeds a workspace with two `results_table` panels (in a known
  order) and runs a screener.
- Asserts the first panel's source is bound to the new run.
- Asserts the second panel's source is unaffected (still whatever it was
  before, or unbound if it started unbound).
