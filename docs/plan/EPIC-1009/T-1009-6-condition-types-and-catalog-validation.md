# T-1009-6: Eight condition types with catalog validation

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
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
