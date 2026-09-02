# T-1009-6: Eight condition types with catalog validation

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Done
**Depends on**: T-1009-4
**Blocks**: T-1009-7, T-1009-8

## Description

T-1009-4 moves nodes around; this ticket decides what may go in one. It
delivers the eight condition types the design spec requires and validates
each against the catalog registry at edit time, so an agent learns a
condition is wrong on the turn it writes it rather than at run time. This
is also where the "no raw SQL or JavaScript" exclusion becomes an
enforced property: a condition that could carry an expression is rejected
because the model has nowhere to put one.

## User Story

As an AI agent expressing a trading idea as filters,
I want to state scalar, range, series, temporal, event, pattern,
relative, and study conditions in a typed form that tells me immediately
when I have named something that does not exist,
so that building a screen is one corrective turn rather than a guessing
loop.

## Acceptance Criteria

1. A **scalar** condition (for example price greater than 10) stores a
   field, an operator, a value, and its unit, and is rejected when the
   value's type or magnitude falls outside the field's declared type and
   valid range.
2. A **range** condition (for example RSI between 40 and 70) stores lower
   and upper bounds with their inclusivity, and is rejected when the lower
   bound exceeds the upper.
3. A **series comparison** condition (for example MA50 above MA200) stores
   both series with their parameters and a comparison operator, and is
   rejected when the two series are not comparable.
4. A **temporal** condition (for example crossed above within the last
   five bars) stores an inner condition, a direction, a bar count, and an
   interval, and is rejected when the interval is not in the catalog.
5. An **event-relative** condition (for example earnings within the next
   30 days) stores an event type, a past/future direction, and a window,
   and is rejected when that event calendar is unavailable for the
   screener's universe.
6. A **pattern** condition (for example bull flag with confidence above
   0.75) stores a pattern ID, a confidence threshold within the pattern's
   declared range, and the interval it is detected on.
7. A **relative** condition (for example volume greater than 1.5x its
   20-day average) stores a field, a baseline reference, a multiple, and
   an operator.
8. A **study output** condition (for example MACD histogram positive and
   rising) stores a study ID, its parameters, a named output, and a state
   predicate, and is rejected when the named output is not one that study
   declares.
9. A condition naming any field, operator, study, indicator, pattern, or
   interval absent from the catalog registry is rejected, naming the
   unknown item, and the tree is left unchanged.
10. A condition parameter outside its catalog item's declared valid range
    is rejected, naming the parameter and its permitted range.
11. A submitted condition containing SQL, JavaScript, or any free-form
    expression string is rejected; no condition variant exposes a field
    that is parsed or evaluated as code.
12. Every rejection identifies the offending condition well enough for an
    agent to correct it in one turn, following the existing
    self-correcting error convention.
13. Tests cover, for each of the eight types, at least one accepted case
    and one rejected case, plus unknown catalog items, out-of-range
    parameters, and an attempted raw-expression payload.

## Design References

- `docs/design/screener-core/spec.md` — the "Express eight condition
  types" scenario table; each AC above traces to a row.
- `docs/design/screener-core/technical.md` — the `Condition` union and
  what each variant carries.
- `docs/reference/tool-spec.md` — the eight condition types and the explicit
  exclusion of raw SQL/JavaScript execution.
- `src/lib/webmcp/tools.ts` — the existing self-correcting error
  convention (an error that returns the valid options back to the agent).

## Technical Considerations

- Catalog item metadata — declared type, unit, valid range, defaults,
  declared outputs, data availability — comes from EPIC-1008's registry.
  Do not hardcode a field or study list.
- Temporal conditions nest an inner condition, so validation must recurse
  rather than assume a flat shape.
- Event-calendar availability is a data-availability question answered by
  the catalog registry, not by fetching a calendar here.

## Out of Scope

Evaluating a condition against real data (T-1009-7), whole-screener
problem reporting such as contradictions and cost (T-1009-8), and
registration (T-1009-10).

## Solution Approach

### Modules

- `src/lib/screener/conditionValidation.shared.ts` (new) — the
  `ConditionValidationContext`/`ResolvedContext` types and the helpers every
  per-variant validator shares: `problem`, `unknownItemProblem`,
  `withinRange`, `describeRange`, `findDisallowedConditionFields`,
  `validateOperatorForField`, `checkTypedValue`, `validateCatalogParams`,
  `extraFieldProblems`. Exists so `conditionValidation.ts` and
  `conditionValidation.catalog.ts` can both depend on it without depending
  on each other (avoids a circular import between the two variant-bearing
  files).
- `src/lib/screener/conditionValidation.ts` (new) — the exported entry
  point `validateCondition(condition, context?)`, its `Record`-keyed
  dispatch table, and the four structurally simpler variants: scalar,
  range, series_comparison, temporal (the only recursive variant).
- `src/lib/screener/conditionValidation.catalog.ts` (new) — the four
  variants whose rules lean hardest on catalog lookups: event_relative,
  pattern, relative, study_output, plus the `STUDY_OUTPUT_PREDICATES`
  closed union (no such enumeration exists elsewhere in the codebase, so
  this validator defines its own contract for AC8's "predicate is a member
  of a closed union").
- `src/lib/webmcp/screener/editFilterTree.ts` (modified) — `add` and
  `update` now reject before any write: `parseConditionInput` first checks
  the raw payload's keys against `CONDITION_FIELD_ALLOWLIST` via
  `findDisallowedConditionFields` (AC11, before `normalizeCondition` would
  otherwise silently drop a stray `expression`/`sql`/`js` key), then
  normalizes, then runs `validateCondition` against an injected
  `CatalogRegistry` (default `builtinCatalogRegistry`) and the screener's
  `UniverseSpec` (AC5). Every rejection reuses the existing
  `FilterTreeOpFailure` → `OperationValidationError` path — no second error
  shape. `createEditFilterTreeTool` gained a second, defaulted `registry`
  parameter; `WorkbenchDeps` is untouched.

### Exported entry point

```ts
function validateCondition(
	condition: Condition,
	context?: { registry?: CatalogRegistry; universe?: UniverseSpec; nodeId?: ResourceId }
): ValidationProblem[];
```

Empty array means valid. `context.registry` defaults to
`builtinCatalogRegistry`; `context.universe` is consulted by
`event_relative`'s availability check; `context.nodeId` populates
`ValidationProblem.nodeIds` (absent on a not-yet-written `add`, since no
node id exists yet).

### Test plan

- `conditionValidation.test.ts` — scalar, range, series_comparison,
  temporal, dispatch/injected-registry behavior, and the AC11 raw-field
  rejection (`expression`, `sql` keys on an otherwise valid condition).
- `conditionValidation.catalog.test.ts` — event_relative, pattern,
  relative, study_output. Uses `builtinCatalogRegistry` wherever the real
  seeded inventory (`src/lib/catalog/items.ts`) covers the scenario, and a
  small fixture `CatalogRegistry` (mirroring `registry.ts`'s real query
  semantics, the same pattern `universeValidation.test.ts` already uses)
  only where the seeded inventory cannot express the scenario — e.g. every
  seeded pattern and earnings-adjacent field is deliberately unavailable,
  so an *accepted* pattern/event_relative case needs a fixture item with
  `availability.status: 'available'`; a *required* catalog parameter needs
  a fixture study, since no seeded study declares one.
- `editFilterTree.test.ts` — existing fixtures switched from placeholder
  IDs (`'price'`, `'gt'`) to real catalog IDs (`field.price.close`,
  `op.greater_than`) now that add/update validate against the catalog; new
  tests cover AC9 (unknown field, out-of-range value) and AC11 (raw
  `expression` key) at the tool layer, each asserting the tree and the
  workspace revision are both unchanged.
- Per-type coverage (AC13): each of the eight types gets at least one
  accepted and one rejected case; unknown-catalog-item, out-of-range
  parameter, and raw-expression-payload are each covered by at least one
  test across the suite.
