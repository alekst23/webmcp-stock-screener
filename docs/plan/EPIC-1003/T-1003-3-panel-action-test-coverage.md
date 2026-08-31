# T-1003-3: Add removePanel persistence round-trip test

**Epic:** EPIC-1003
**Status:** Open

## Goal

Epic review of EPIC-1003 found `store.test.ts`'s `'individual panel removal'`
tests (T-1003-2) cover removal semantics but, unlike the file's own
`'workspace persistence'` pattern (every mutating capability gets a reload
round-trip test), have no test asserting a `removePanel` call survives a
simulated reload.

(Originally this ticket also covered test coverage for the panel-scoped
histogram toggle — that feature was removed entirely on 2026-08-31, so
that acceptance criterion no longer applies.)

## Acceptance criteria

- A `store.test.ts` test constructs a second store off the same `Storage`
  after calling `removePanel`, asserting the removed panel does not
  reappear — matching the file's existing persistence round-trip pattern.
