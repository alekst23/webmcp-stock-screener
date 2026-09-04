# T-0020-12: Disambiguate screener-revision vs. workspace-revision in the tool surface

**Epic:** EPIC-0020
**Status:** Open

## Goal

`run_screener` and `define_screener` already correctly model two distinct revision
concepts in code — `expected_revision` (the workspace's own revision, checked via
`RevisionConflictError`) and `screener_revision` (the screener definition's own
revision, resolved via `resolveScreenerRevision()` in `runScreener.ts:118-138`,
rejected via a distinct `OperationValidationError`). An agent conflated the two
live (2026-09-04): it passed the workspace revision where `screener_revision` was
expected, the call was rejected, and it took a retry to recover. The two concepts
are correctly separated in the code; they were not correctly separated in what the
tool surface *tells* an agent about them.

This does **not** add a new `get_screener_definition` (or similar) read tool —
`docs/design/screener-core/spec.md` already made an explicit "no separate read
tool" decision for MVP and this ticket does not reverse it. It only sharpens
existing parameter descriptions and error text.

## Acceptance criteria

- `run_screener`'s and `define_screener`'s tool schema descriptions for
  `expected_revision` and `screener_revision` (where each is accepted) name which
  concept each refers to distinctly enough that reading them alone prevents
  conflating the two (e.g. explicitly stating "this is the workspace's own
  revision, not the screener definition's" and vice versa).
- The `OperationValidationError` raised by `resolveScreenerRevision()` when an
  unretained/wrong `screener_revision` is supplied states plainly that a screener
  revision (not a workspace revision) was expected, and what was received.
- A test snapshots or asserts on the relevant tool description text and the error
  message text, so a future edit that erodes the distinction is caught.
