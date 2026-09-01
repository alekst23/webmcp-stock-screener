# T-1008-5: `search_catalog` tool

**Epic**: EPIC-1008 (Discovery & Catalog)
**Design**: docs/design/discovery-and-catalog/
**Status**: Open
**Depends on**: T-1008-2
**Blocks**: T-1008-7

## Description

An agent asked to "screen for stocks whose relative volume is above 1.5x"
needs to find out what the app calls relative volume, and whether "above"
is an operator it supports. This ticket delivers the tool that searches the
T-1008-2 registry across every catalog kind and returns ranked, stable-ID
matches. Done looks like: a text query, optionally narrowed by kind,
returns the items that exist — and returns them in a form the agent can
feed straight into `describe_catalog_item`.

## User Story

As an AI agent about to build a filter, configure a chart, or set a
universe,
I want to search the app's catalog by free text and by kind,
so that I use identifiers the app actually recognizes instead of guessing a
name that looks reasonable.

## Acceptance Criteria

1. The tool accepts a free-text query, an optional list of kinds to restrict
   the search to, an option to include items whose data is currently
   unavailable, and a result limit, each declared in its input schema with
   an agent-actionable description.
2. The declared kinds are exactly the registry's kinds: field, operator,
   study, indicator, pattern, interval, universe, template.
3. A result lists matching items in descending relevance order, each with
   its stable ID, kind, label, short description, and availability status.
4. Matching considers an item's label, ID, aliases, and tags, so a query
   using a common synonym finds the item.
5. Restricting to one or more kinds returns only items of those kinds.
6. By default, items whose data is unavailable are included but clearly
   marked as such; the caller can opt to exclude them.
7. An empty query with a kind restriction lists that kind's items, so an
   agent can enumerate what exists rather than having to guess a search term.
8. A query matching nothing returns an explicit empty-match success stating
   the query and any kind restriction applied — not an error.
9. The result carries the provenance envelope, with the catalog identified
   as a static, in-application source and the calculation-engine version
   stated.
10. The result limit is clamped to a documented maximum.
11. The tool performs no mutation and takes no revision or idempotency
    parameter.
12. Unit tests cover: a match by label; a match by alias; a kind-restricted
    search; enumeration via empty query plus kind; an empty-match query;
    inclusion and exclusion of unavailable items; relevance ordering; and
    limit clamping.

## Design References

- `.dev/design/tool-spec.md` — `search_catalog`'s stated purpose and the
  eight kinds it must cover.
- `docs/design/discovery-and-catalog/spec.md` — the "Search the catalog"
  scenarios.
- `docs/design/discovery-and-catalog/technical.md` — the registry query
  surface this tool wraps.
- `src/lib/webmcp/tools.ts` — tool-authoring conventions and result shaping.

## Technical Considerations

- New files only; do not add to `src/lib/webmcp/tools.ts`.
- Ranking should be simple and explainable (exact ID, exact label, prefix,
  alias, substring, tag). Resist anything a reader cannot predict — an agent
  that cannot anticipate ordering will re-query rather than trust it.
- Keep the search logic in the registry module's query surface where
  EPIC-1009 and EPIC-1011 can reuse it, with this ticket delivering the tool
  wrapper, schema, and result shaping.

## Out of Scope

- Returning full parameter/output detail for an item — that is
  `describe_catalog_item` (T-1008-6). Search results stay summary-sized.
- Registering the tool with the WebMCP session (T-1008-7).
