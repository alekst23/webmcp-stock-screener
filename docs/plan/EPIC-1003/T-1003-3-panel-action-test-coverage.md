# T-1003-3: Add automated test coverage for panel-scoped histogram and removePanel persistence

**Epic:** EPIC-1003
**Status:** Open

## Goal

Epic review of EPIC-1003 found two test-coverage gaps. T-1003-1 (panel-scoped
histogram) relies entirely on a one-time manual `/at-browser-check` for its
acceptance criteria — no automated test asserts `GridPanel.svelte` actually
renders/imports `HistogramPanel`, or that `+page.svelte`'s old standalone
per-instance-set histogram loop stays gone. A future refactor could silently
re-detach the toggle with nothing failing in CI. Separately, `store.test.ts`'s
`'individual panel removal'` tests (T-1003-2) cover removal semantics but,
unlike the file's own `'workspace persistence'` pattern (every mutating
capability gets a reload round-trip test), have no test asserting a
`removePanel` call survives a simulated reload.

## Acceptance criteria

- A test (component-level or a targeted assertion the codebase's tooling
  supports) verifies each grid panel renders its own scoped histogram toggle
  and that no standalone/disconnected histogram list exists.
- A `store.test.ts` test constructs a second store off the same `Storage`
  after calling `removePanel`, asserting the removed panel does not
  reappear — matching the file's existing persistence round-trip pattern.
