# T-1008-4: `search_instruments` tool

**Epic**: EPIC-1008 (Discovery & Catalog)
**Design**: docs/design/discovery-and-catalog/
**Status**: Open
**Depends on**: T-1008-1, T-1008-3
**Blocks**: T-1008-7

## Description

The first tool an agent reaches for: turn whatever the user said — a
ticker, a company name, a partial name — into canonical instrument IDs it
can pass to every other tool. This ticket delivers the WebMCP tool
definition and its handler over the T-1008-3 port. Done looks like: an
agent calls it with "apple", gets back ranked candidates with canonical
IDs, exchanges, and asset types plus provenance, and can tell whether an
empty result means "no such instrument" or "reference data not wired up
yet".

## User Story

As an AI agent given a company or ticker in free text,
I want ranked candidate instruments with canonical IDs, exchange, asset
type, country, currency, and listing status,
so that I can proceed with a real identifier, or ask the user to
disambiguate when several listings match.

## Acceptance Criteria

1. The tool accepts free text plus optional narrowing by asset type,
   exchange, and country, an option to include delisted instruments, and a
   result limit, and it declares each of these in its input schema with a
   description an agent can act on.
2. The tool's declared schema requires the free-text query and rejects a
   call without one before any lookup happens.
3. A result lists candidate instruments in descending match order, each with
   its canonical instrument ID, symbol, name, exchange and MIC, asset type,
   country, currency, primary-listing flag, listing status, match score, and
   which attribute matched.
4. The result carries the provenance envelope: `as_of`, source, delivery
   status, timezone, and engine version, with currency stated per instrument
   rather than assumed globally.
5. When several candidates match, all of them are returned up to the limit
   and none is silently promoted to "the answer".
6. When nothing matches, the result is an explicit empty-match success
   stating the query that found nothing — not an error.
7. When no reference-data source is configured, the result is well-formed,
   reports the data as unavailable with a reason naming the dependency, and
   returns no fabricated instruments.
8. When the underlying source fails, the tool returns an error result whose
   message names what failed, in the same shape the existing tool surface
   uses for errors.
9. The result limit is clamped to a documented maximum so an agent cannot
   request an unbounded page.
10. The tool performs no mutation and takes no revision or idempotency
    parameter.
11. Unit tests cover: a single-match query; a multi-candidate query with
    ordering asserted; narrowing by asset type and by exchange; an
    empty-match query; the unconfigured-source path; the source-failure
    path; and limit clamping. Tests drive the tool through the T-1008-3 test
    double, not a live source.

## Design References

- `docs/reference/tool-spec.md` — `search_instruments`' stated purpose; the
  stable-ID rule; the provenance requirement.
- `docs/design/discovery-and-catalog/spec.md` — the "Resolve an instrument"
  scenarios.
- `src/lib/webmcp/tools.ts` — existing tool-authoring conventions: JSON
  input schemas with agent-directed descriptions, `ok`/`fail` result
  shaping, the `available` predicate, and the practice of returning
  corrective information in an error so the agent self-corrects in one turn.
- `src/lib/webmcp/types.ts` — `ToolSpec` / `ToolResult`.

## Technical Considerations

- New files only. Do not add to `src/lib/webmcp/tools.ts`; the new surface's
  tools live alongside it and are registered separately (T-1008-7).
- Tool descriptions are read by an agent as its only documentation. Say what
  the tool resolves, what an ID is good for, and what an ambiguous result
  means.
- Follow the existing precedent of returning actionable detail on failure:
  an unavailable-source result should tell the agent it cannot proceed with
  instrument-scoped work, not just that something went wrong.

## Out of Scope

- Building or wiring a real reference-data source.
- Registering the tool with the WebMCP session (T-1008-7).
