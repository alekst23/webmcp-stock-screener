# T-1008-6: `describe_catalog_item` tool

**Epic**: EPIC-1008 (Discovery & Catalog)
**Design**: docs/design/discovery-and-catalog/
**Status**: Open
**Depends on**: T-1008-2
**Blocks**: T-1008-7

## Description

Finding that `study.rsi` exists is only half the job — an agent then needs
to know it takes a `length` parameter defaulting to 14 with a valid range,
that it outputs a 0-100 oscillator, and over which intervals the data
exists. This ticket delivers the tool that returns one catalog item's full
detail from the T-1008-2 registry. Done looks like: an agent can configure
a study, a filter condition, or a universe correctly on its first attempt
because every parameter, unit, range, default, output, and availability
window was declared to it.

## User Story

As an AI agent that has found a catalog item by ID,
I want its parameters with types, units, defaults, and valid ranges, its
outputs, and its data availability,
so that I can configure it correctly the first time instead of discovering
its constraints through rejected calls.

## Acceptance Criteria

1. The tool accepts one catalog item ID, declared as required in its input
   schema.
2. For a known ID, the result states the item's stable ID, kind, label,
   description, aliases, and tags.
3. For a known ID, the result states every parameter the item accepts, each
   with its value type, unit where one applies, default value, and valid
   range or enumerated values, and whether it is required.
4. For a known ID, the result states every output the item produces, each
   with its value type and unit where one applies.
5. For a known ID, the result states data availability: whether the item is
   available, partially available, or unavailable; the reason when it is
   not; the intervals it is available over; and the earliest and latest data
   where those are known.
6. Kind-specific detail is included where it exists: a field's nullability
   and fundamentals reporting basis; an operator's arity, accepted operand
   types, and condition family; an interval's bar duration; a universe's
   membership source; a template's target.
7. An unknown ID returns an explicit not-found result naming the ID it was
   given, and — where the ID is close to a real one — suggests the nearest
   catalog IDs so the agent can self-correct in one turn.
8. Requesting an item that depends on reference data not yet supplied
   returns the item's full declared detail with availability reported as
   unavailable and the reason naming the dependency — not a not-found.
9. The result carries the provenance envelope, with the catalog identified
   as a static, in-application source and the calculation-engine version
   stated.
10. The tool performs no mutation and takes no revision or idempotency
    parameter.
11. Unit tests cover: describing an item of each kind, asserting the
    kind-specific detail is present; an unknown ID producing a not-found
    with suggestions; a near-miss ID producing a useful suggestion; and a
    reference-data-dependent item returning full detail with unavailable
    status.

## Design References

- `docs/reference/tool-spec.md` — `describe_catalog_item`'s stated purpose:
  "parameters, units, valid ranges, defaults, outputs, and data
  availability".
- `docs/design/discovery-and-catalog/spec.md` — the "Describe a catalog
  item" scenarios.
- `docs/design/discovery-and-catalog/technical.md` — the catalog item type
  model this tool projects into a result.
- `src/lib/webmcp/tools.ts` — the existing precedent of returning the
  available catalog on a bad input so the agent corrects in one turn rather
  than looping (see the `ExpressionError` handling and `FUNCTION_CATALOG`).

## Technical Considerations

- New files only; do not add to `src/lib/webmcp/tools.ts`.
- The suggestion behavior on an unknown ID is the single highest-value part
  of this tool for agent ergonomics, and mirrors an established convention
  in this codebase. Keep suggestions cheap and deterministic.
- The result is a projection of the registry item, not a second copy of the
  type. Deriving it from the registry avoids the two drifting apart.

## Out of Scope

- Searching or listing (T-1008-5).
- Evaluating the item or fetching its data.
- Registering the tool with the WebMCP session (T-1008-7).
