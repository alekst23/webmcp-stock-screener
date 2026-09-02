# T-1014-1: Typed expression model and validator

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Done
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

## Solution Approach

New files under `src/lib/workbench/followup/domain/` (a new `followup` feature
folder, sibling to `chart/` and `similarity/`, holding the domain-layer files
this and later EPIC-1014 tickets need; flat files inside `domain/` matching
the existing `workbench/domain/` and `chart/domain/` convention rather than a
further nested subfolder). No existing file is modified. All files are pure
domain: no I/O, no imports from `src/lib/webmcp/`, and they import only the
published `CatalogRegistry` port from `src/lib/catalog/registry.ts` and types
from `src/lib/catalog/types.ts`.

- `expressionModel.ts` -- the typed node union and result-shape types.
- `expressionLimits.ts` -- configurable cost-limit constants.
- `expressionErrors.ts` -- `ExpressionValidationError`, following the
  `SafetyError` pattern in `domain/previewErrors.ts` (reason enum + static
  factories + `details` bag + `toWireError()`), each factory attaching the
  permitted vocabulary relevant to that failure.
- `expressionValidator.ts` -- `validateExpression()`.
- `expressionEvaluator.ts` -- the evaluation port and `evaluateExpression()`.

### The node model (AC1, AC9)

`ExpressionNode` is a discriminated union on a `kind` string, closed to
exactly five variants -- no variant holds free-form text that is later
parsed or interpreted:

- `literal`: `{ kind: 'literal'; valueType: 'number' | 'string' | 'boolean'; value: number | string | boolean }`.
  A string literal is inert data (e.g. an enum parameter value); it is never
  parsed, concatenated into a query, or passed to an interpreter.
- `field_ref`: `{ kind: 'field_ref'; fieldId: string }`. `fieldId` is only
  ever used as a `CatalogRegistry.getCatalogItem` lookup key.
- `function_call`: `{ kind: 'function_call'; functionId: string; args: Record<string, number | string | boolean>; outputName?: string }`.
  `functionId`/`outputName`/arg keys are only ever used as lookup keys against
  the catalog item's declared `parameters`/`outputs`; arg values are literal
  data compared against declared type/range/enum, never executed.
- `arithmetic`: `{ kind: 'arithmetic'; op: '+' | '-' | '*' | '/'; left: ExpressionNode; right: ExpressionNode }`.
- `comparison`: `{ kind: 'comparison'; op: '>' | '<' | '>=' | '<=' | '==' | '!='; left: ExpressionNode; right: ExpressionNode }`.

`op` fields are narrow string-literal unions checked against a fixed
allow-list at runtime (the input arrives as untrusted JSON from a tool call,
so TypeScript's compile-time narrowing alone is not a safety boundary).
There is no "raw"/"sql"/"js" node kind and no node whose value is executed --
the validator's job is exactly to prove an arbitrary JSON payload is one of
these five shapes before anything downstream touches it.

`ExpressionUsage = 'numeric_column' | 'boolean_filter' | 'none'`, and
`ValidatedExpression { node: ExpressionNode; resultType: CatalogValueType;
resultUnit?: string; usage: ExpressionUsage }` is what `validateExpression`
returns on success (AC7). `usage` is derived from `resultType`: `'number'` ->
`'numeric_column'`, `'boolean'` -> `'boolean_filter'`, anything else ->
`'none'`.

### Validation (AC2-AC5, AC8)

`validateExpression(raw: unknown, registry: CatalogRegistry, limits =
DEFAULT_EXPRESSION_LIMITS): ExpressionValidationResult`, where
`ExpressionValidationResult = { valid: true; expression: ValidatedExpression } | { valid: false; error: ExpressionValidationError }`
(mirrors the existing `OperatorFieldCheck` discriminated-result style in
`catalog/types.ts`). A single recursive walk does structural parsing
(rejects anything not shaped like one of the five node kinds) and semantic
resolution together, failing fast on the first problem found (depth-first,
left-to-right) -- consistent with the existing `expression.py` reference and
sufficient for a single-turn correction per AC8, since the response always
names one concrete, fixable problem plus the vocabulary for it.

Per node kind:

- `literal`: `valueType` must be one of the three allowed strings and
  `typeof value` must match it exactly (guards against an object/array/
  function smuggled in as `value` by a caller bypassing the type system).
- `field_ref`: resolve `fieldId` via `registry.getCatalogItem`; must exist
  and be `kind: 'field'`. On failure: `unresolved_field`, vocabulary =
  `registry.suggestCatalogIds(fieldId)` if non-empty, else all field IDs
  (bounded).
- `function_call`: resolve `functionId`; must exist and be `kind: 'study' |
  'indicator' | 'pattern'` (the three catalog kinds sharing
  `ComputedItemCore`'s `parameters`/`outputs` shape). On failure:
  `unresolved_function`, vocabulary = suggestions or all study/indicator/
  pattern IDs. Then, against the resolved item's declared `parameters`:
  every `required` parameter must be present (`missing_argument`, vocabulary
  = the missing parameter names); every supplied arg name must be declared
  (`unexpected_argument`, vocabulary = the declared parameter names); each
  supplied value's JS type must match its parameter's `valueType`
  (`number`/`boolean` map directly, `enum`/`date`/`string` all accept a JS
  string, with `enum` additionally checked against `enumValues`) --
  `argument_type_mismatch`; numeric values with a declared `range` are
  bounds-checked -- `argument_out_of_range`. Missing optional parameters are
  filled from `defaultValue` into a normalized `args` map so the evaluator
  never has to consult the catalog itself. Any parameter whose `unit` is
  `'bars'` is checked against `limits.maxLookbackBars` --
  `lookback_exceeded` (AC5's "lookback window" bound). Then `outputName`:
  if omitted and the item has exactly one output it is filled in; if
  omitted with more than one output, or if supplied but not a declared
  output name, that is `ambiguous_output`/`unknown_output` (vocabulary =
  declared output names). Result type/unit come from the selected
  `CatalogOutput`.
- `arithmetic`: both operands validated recursively first. Both must have
  `resultType === 'number'` (a `date` or other non-numeric operand is
  `type_mismatch` here, which is what catches "a date minus a currency
  amount" -- the type check fires before any unit comparison). For `+`/`-`,
  two *conflicting* units -- both explicitly declared and different (e.g.
  currency vs shares) -- is `unit_mismatch`; a plain literal is unitless and
  therefore compatible with any unit (`close - 5` and `close > 100` must
  validate, not just `close - close`), so the mismatch check only fires when
  both sides declare a unit and it differs; the result carries whichever
  side's unit is defined. For `*`/`/`, units are never rejected (a
  documented, deliberate simplification: the result is treated as a derived
  quantity) -- result unit is the one explicit unit if exactly one operand
  has a unit and the other doesn't, else `undefined` (including when both
  operands declare a unit, since e.g. currency/shares is a new quantity, not
  either input's).
- `comparison`: both operands validated recursively first, must have
  identical `resultType` (`type_mismatch` otherwise) and, when numeric, must
  not have conflicting units under the same rule as `+`/`-` above
  (`unit_mismatch` otherwise). Result type is always `'boolean'` with no
  unit.

Cost bounds (AC5) are checked throughout the same walk: current nesting
depth vs `limits.maxDepth` (`depth_exceeded`), a running node counter vs
`limits.maxNodes` (`node_count_exceeded`), and the per-parameter lookback
check described above (`lookback_exceeded`). All three name the limit that
was exceeded and its configured value.

### Limits (AC5)

`expressionLimits.ts` exports `ExpressionCostLimits { maxDepth: number;
maxNodes: number; maxLookbackBars: number }` and
`DEFAULT_EXPRESSION_LIMITS: ExpressionCostLimits = { maxDepth: 8, maxNodes:
64, maxLookbackBars: 500 }` (500 matches the widest `range.max` already
declared on `LENGTH_PARAM` in the catalog, so the default doesn't clip any
existing built-in study). `validateExpression` takes limits as a parameter
with this default, so nothing is a magic number inline in the validator.

### Evaluation semantics (AC6)

`expressionEvaluator.ts` declares the port the run-path (T-1014-2 and later)
implements, and a pure walker over an already-validated tree -- no registry
or I/O needed at this layer, because validation already normalized
`function_call` args/outputName onto the tree:

```
export interface ExpressionEvaluationContext {
  getFieldValue(fieldId: string): number | string | boolean | null;
  getFunctionOutput(
    functionId: string,
    args: Readonly<Record<string, number | string | boolean>>,
    outputName: string
  ): number | string | boolean | null;
}
export type EvaluatedValue = { available: true; value: number | string | boolean } | { available: false };
export function evaluateExpression(expression: ValidatedExpression, ctx: ExpressionEvaluationContext): EvaluatedValue;
```

`null` from the port means "not available for this row" and propagates: a
missing field/function output, or an arithmetic `/` whose right operand
evaluates to `0`, yields `{ available: false }` for that node and every node
above it, rather than `NaN`/`Infinity`/a thrown error (AC6). This ticket
supplies the port and the walker only; a real context wired to panel data at
screener-run scale is explicitly out of scope (T-1014-2 / the screener
epic).

### Testing (mutation-checked)

Colocated `*.test.ts` per file, Vitest, `test_<action>_<condition>_<expected>`
naming with assertion messages, matching `catalog/registry.test.ts`. A
dedicated `expressionValidator.test.ts` section covers AC9 explicitly:
attempts to smuggle a SQL string, a JS expression, `__proto__`/prototype-
pollution keys, and an unknown `kind` (e.g. `'raw_sql'`) through every string-
accepting position (`literal.value`, `field_ref.fieldId`,
`function_call.functionId`, an arg value, `outputName`, `arithmetic.op`,
`comparison.op`), asserting each is rejected and, via a source-text scan of
the four new non-test files, that none of `eval(`, `new Function`, or a
template-literal-based interpreter appears anywhere in the implementation.
Each new test is mutation-checked per the workflow: temporarily revert the
corresponding check, confirm the test fails, then restore.

## Out of Scope

- The `create_computed_field` and `create_custom_study` tools themselves
  (T-1014-2).
- Any UI for authoring or editing an expression.
- Evaluating expressions at screener-run scale — this ticket defines and
  validates the model and specifies evaluation semantics; wiring it into
  the run path is T-1014-2's and the screener epic's concern.
