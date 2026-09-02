# T-1006-2: Mutation envelope contract and builder

**Epic**: EPIC-1006 (Workspace, Revisions & the Common Tool Contract)
**Design**: docs/design/workspace-revisions/
**Status**: Done
**Depends on**: —
**Blocks**: T-1006-5

## Description

The design doc fixes one result shape for every mutation in the program:
change ID, new revision, affected IDs, diff summary, warnings, undo token.
This ticket defines that envelope, the context every mutation accepts
(`expected_revision`, `idempotency_key`, actor), the typed errors a
rejected mutation raises, and the serializer that turns internal camelCase
into the snake_case JSON agents see. Every one of the ~33 tools in the
program returns this shape, so getting it wrong is expensive later.

## User Story

As an agent calling any mutating tool in the workbench,
I want the same result shape back every time, whatever I called,
so that I can read the revision, show the human the diff, and keep the undo
token without special-casing each tool.

## Acceptance Criteria

1. A mutation envelope carries a change ID, the new revision, the list of
   affected resource IDs, a one-sentence human-readable diff summary, a
   list of warnings and an undo token.
2. The undo token may be explicitly absent, marking a change that cannot be
   reversed; absence is distinguishable from an empty string.
3. Building an envelope defaults the warnings list to empty rather than
   leaving it undefined, so callers never have to guard it.
4. An envelope serializes to the exact snake_case JSON field names the
   design doc specifies, and serialization is the only place snake_case
   appears.
5. A mutation context carries an optional expected revision, an optional
   idempotency key and a required actor identifying whether a human or an
   agent initiated the change.
6. A revision conflict is raised as a distinct typed error carrying both
   the revision the caller expected and the revision actually current.
7. An idempotency conflict, an undo-token failure and an operation
   validation failure are each raised as their own distinct typed error,
   so callers branch on type rather than parsing messages.
8. An undo-token failure states which of unknown, already-redeemed or
   superseded applies.
9. Every typed error serializes to a consistent machine-readable failure
   shape suitable for returning from a tool.

## Design References

- `docs/reference/tool-spec.md` — "Common contract for every tool" gives the
  literal JSON envelope this ticket must reproduce.
- `docs/design/workspace-revisions/technical.md` — "T-1006-2" section and
  the "Casing: internal vs. wire" rule.
- `src/lib/webmcp/tools.ts` — the existing `ok` / `fail` `ToolResult`
  helpers show the project's current error-shaping convention.

## Solution Approach

`mutation.ts`: `buildEnvelope` is a thin defaulting constructor (`warnings
?? []`, `undoToken ?? null`) over the `MutationEnvelope` shape; `toWireEnvelope`
is the one function in the epic allowed to emit snake_case keys, mapping
`changeId → change_id`, `newRevision → new_revision`, etc. one-to-one, no
other transformation. `MutationContext` is a plain interface — no builder
needed since every field is either optional or trivially supplied by the
caller.

`errors.ts` defines four `Error` subclasses per `technical.md`, each with a
`toWireError()` method returning `{ error: <kind>, message, ...fields }`
where `<kind>` is a stable machine-readable string
(`revision_conflict`/`idempotency_conflict`/`undo_token_error`/
`operation_validation_error`) callers switch on. `UndoTokenError` takes a
`reason` in its constructor rather than inferring it, so T-1006-6 states
the reason explicitly at the call site instead of this module guessing.

**Contracts introduced:** `Actor`, `MutationEnvelope`, `MutationContext`,
`buildEnvelope`, `toWireEnvelope`, `RevisionConflictError`,
`IdempotencyConflictError`, `UndoTokenError`, `OperationValidationError` —
`src/lib/workbench/domain/mutation.ts` and `.../domain/errors.ts`.

## Technical Considerations

- Modules: `src/lib/workbench/domain/mutation.ts` and
  `src/lib/workbench/domain/errors.ts`. Pure domain, no I/O.
- Exported contract surface other epics depend on: `Actor`,
  `MutationEnvelope`, `MutationContext`, `buildEnvelope`,
  `toWireEnvelope`, `RevisionConflictError`, `IdempotencyConflictError`,
  `UndoTokenError`, `OperationValidationError`, and each error's
  `toWireError()`.
- The diff summary is prose for a human, not a serialized patch. Keep it a
  single present-tense sentence; sibling epics generate theirs from their
  own operation `describe`.
- Warnings are additive strings, not an enum — T-1006-5 appends the
  missing-`expected_revision` warning through the same list.
- Tests must assert the serialized field names literally against the
  design doc's example, since a typo there breaks every sibling epic
  silently.

## Out of Scope

Producing envelopes from real state changes, revision checking and
idempotency replay — all T-1006-5. This ticket delivers the shape, the
builder, the errors and the serializer.
