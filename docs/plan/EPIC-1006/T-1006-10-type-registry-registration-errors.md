# T-1006-10: Type `OperationRegistry.register`'s errors

**Epic:** EPIC-1006
**Status:** Open

## Goal

`application/operationRegistry.ts`'s `register()` throws raw `Error` for a
malformed or duplicate operation kind, while every other failure path this
epic introduces (`RevisionConflictError`, `IdempotencyConflictError`,
`UndoTokenError`, `OperationValidationError`, `StorageWriteError`) is a typed
class with `toWireError()`. `tools/index.ts`'s `toErrorResult()` only
special-cases the typed errors, so a raw `Error` here falls through to the
untyped `fail(err.message)` branch and loses a machine-readable error code.

Registration happens at composition-root time today, not per-request, so this
is low severity now -- but nine sibling epics will call `register()` to add
their own operations, and copying the untyped pattern would spread it.

## Acceptance criteria

- `register()` throws a typed error (new or reused from `domain/errors.ts`)
  with a `toWireError()` implementation for both the malformed-kind and
  duplicate-kind cases.
- `toErrorResult()` in `tools/index.ts` recognizes it.
- Existing tests for `register()`'s failure paths assert the typed error.
