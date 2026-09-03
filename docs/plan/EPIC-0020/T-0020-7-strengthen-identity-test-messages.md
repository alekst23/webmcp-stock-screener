# T-0020-7: Add assertion messages to the composition root's identity test

**Epic:** EPIC-0020
**Status:** Open

## Goal

`workbenchCompositionRoot.test.ts`'s test proving T-0020-1's central
thesis — one shared repository/revisions/idempotency/runs instance
threaded into every tool group, not independent copies — has no context
messages on any of its identity assertions (`expect(x).toBe(y)` with no
third argument), unlike its sibling test files in the same epic
(`runScreener.test.ts`, `workbenchCompositionRoot.e2e.test.ts`), which
consistently carry AC-referencing messages. This is the epic's single most
important correctness proof and the place a clear failure message matters
most. Found by EPIC-0020's epic review (2026-09-02).

## Acceptance criteria

- Every identity assertion in `workbenchCompositionRoot.test.ts` carries a
  message stating what shared-instance wiring it proves (e.g. "screener
  tools must share the panel runtime's WorkspaceRepository, not build
  their own").
- The two `isError` checks that currently dump `JSON.stringify(x)` as their
  message are replaced with a stated expectation instead.
