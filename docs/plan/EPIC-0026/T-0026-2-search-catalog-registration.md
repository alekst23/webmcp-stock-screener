# T-0026-2: `search_catalog` registration + sector enumeration

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/discovery-and-catalog/
**Status**: Not started
**Depends on**: —
**Blocks**: T-0026-3

## Description

`search_catalog` (`webmcp/discovery/searchCatalog.ts`) already does most
of what an agent needs to compose a correct screener without guessing —
it exists, it is simply never registered on the live composition root.
This ticket registers it, and closes the one real gap: enumerated fields
like `field.sector` don't currently expose their accepted values, so an
agent has no honest way to learn what "energy" resolves to without
guessing or being told out of band.

## User Story

As an agent building a screener,
I want to look up the engine's vocabulary — fields, operators, studies,
intervals, and the accepted values of an enumerated field like sector —
before I compose a condition,
so that I never guess a catalog id and get a confident wrong answer
instead of an error.

## Acceptance Criteria

1. `search_catalog` is registered on the live composition root and
   reachable by an agent.
2. A search or lookup against `field.sector` (or any other enumerated
   field the catalog declares) returns its accepted values alongside its
   existing id/kind/label/description/parameter-schema fields.
3. Every other catalog item kind (operator, study, indicator, pattern,
   interval, universe) returns unchanged from its current behavior.
4. The accepted sector values returned match what the backend's universe
   narrowing (EPIC-0025) actually recognizes — a value `search_catalog`
   offers is guaranteed to be a value the screener endpoint accepts.

## Out of Scope

- `describe_catalog_item` — not needed; `search_catalog`'s results
  already carry the schema inline.
