# T-1014-1: Typed expression model and validator

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Open
**Depends on**: — (consumes EPIC-1008's catalog registry contract)
**Blocks**: T-1014-2
**Issue**: —

## Description

Computed fields and custom studies both need a way to express a
calculation that an agent can author but the app will never `eval`. This
ticket builds that foundation: a typed expression tree over a permitted
vocabulary, plus a validator that resolves every identifier against the
catalog registry, checks types and units, bounds evaluation cost, and
returns errors an agent can correct from in a single turn.

Nothing here is a tool yet — T-1014-2 puts the two authoring tools on top
of it. Building it separately keeps the safety-critical validation
testable on its own, which is where the epic's "no arbitrary code
execution" guarantee actually lives.

## User Story

As the app,
I want every agent-authored calculation to arrive as a typed tree of
permitted operations rather than a string I have to interpret,
so that there is no code path in which an agent's text becomes something
I execute.

## Acceptance Criteria

1. A calculation is expressed as a tree of typed nodes — literals,
   catalog field references, catalog function calls, and arithmetic and
   comparison operators — with no node type whose value is free-form text
   to be interpreted or executed.
2. Validation resolves every field and function reference against the
   catalog registry. An unresolvable reference is rejected, is named in
   the error, and the error carries the permitted alternatives.
3. Validation checks operand types and units. Combining incompatible
   types or units (for example subtracting a currency amount from a date)
   is rejected with an explanation of the mismatch.
4. Validation checks that every function call supplies required
   arguments, that argument counts and types match the catalog's
   declaration, and that parameter values fall inside the catalog's
   declared valid ranges.
5. Validation bounds evaluation cost: an expression exceeding the
   configured limits — nesting depth, node count, or lookback window — is
   rejected naming the limit it exceeded.
6. Evaluating a validated expression against data that is missing, or
   that would divide by zero, yields an explicit "not available" value
   for the affected row rather than raising or silently producing a
   number.
7. A validated expression reports its result type and unit, so callers
   can tell whether it is usable as a numeric column, a boolean filter
   operand, or neither.
8. Every validation failure returns a machine-readable reason plus the
   permitted vocabulary relevant to that failure, so an agent can
   self-correct without a retry loop.
9. Passing a SQL string, a JavaScript expression, or any other free-form
   executable text where an expression is expected is rejected; no code
   path evaluates such text.
10. The model and validator live in new files and change no existing
    module's behavior.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Author a computed
  field" and "Author a custom study" scenarios; the validation and
  no-code-execution rows in particular.
- `docs/reference/tool-spec.md` — the exclusion of raw SQL and JavaScript
  execution, and `describe_catalog_item`'s declared parameters, units,
  valid ranges, defaults, and outputs, which are what validation resolves
  against.
- `docs/plan/EPIC-1008/_epic.md` — the catalog registry contract this
  validator reads permitted fields and functions from.
- `backend/infra/expression.py` and `src/lib/webmcp/types.ts`'s
  `ExpressionError` / `FUNCTION_CATALOG` — the existing surface's
  string-expression approach and its error-carries-the-catalog pattern,
  which is worth borrowing even though the string parsing is not.

## Technical Considerations

- The existing expression surface (`backend/infra/expression.py`,
  `FUNCTION_CATALOG`) parses strings. This ticket deliberately does not:
  the tree arrives typed and the validator resolves it. Do not modify the
  existing surface — EPIC-1015 retires it.
- The catalog registry is EPIC-1008's contract. Code against the port; do
  not re-implement a catalog or hardcode a field list.
- The "no code execution" property is only as good as its tests. Include
  cases that attempt to smuggle executable text through every node type
  that accepts a string (names, labels, identifiers).
- Cost limits should be configurable constants with stated defaults, not
  magic numbers scattered through the validator.

## Out of Scope

- The `create_computed_field` and `create_custom_study` tools themselves
  (T-1014-2).
- Any UI for authoring or editing an expression.
- Evaluating expressions at screener-run scale — this ticket defines and
  validates the model and specifies evaluation semantics; wiring it into
  the run path is T-1014-2's and the screener epic's concern.
