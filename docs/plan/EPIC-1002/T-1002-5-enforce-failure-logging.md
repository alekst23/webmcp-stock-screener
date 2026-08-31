# T-1002-5: Structurally enforce failure logging instead of relying on convention

**Epic:** EPIC-1002
**Status:** Open

## Goal

Epic review of EPIC-1002 found that AC3 ("failed actions appear in the log with a
readable failure reason, not silently dropped") holds today only because every tool
spec in `buildTools` happens to be wrapped by `tools.ts`'s `run()` helper, which
converts thrown errors into `fail()` results before `register.ts`'s
`toDescriptor.execute` records them. `register.ts` itself has no try/catch of its
own — a future tool added to `buildTools` without going through `run()` would throw
past `recordActivity` entirely, silently dropping a failed agent action from the log
with nothing enforcing otherwise (no test, no type).

## Acceptance criteria

- `register.ts`'s `toDescriptor.execute` wrapper itself catches any error a tool's
  `execute` throws and records a failure entry via `recordAction`, rather than relying
  solely on `tools.ts`'s `run()` convention upstream.
- A test adds a tool spec that throws without going through `run()` and asserts a
  failure entry still lands in the activity log.
