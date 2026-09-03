# T-0020-4: Test the first-wins rule when multiple results_table panels exist

**Epic:** EPIC-0020
**Status:** Open

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
