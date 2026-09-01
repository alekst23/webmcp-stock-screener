# EPIC-1008: Discovery & Catalog

**Depends on**: —
**Blocks**: EPIC-1009 (filter tree validates against the catalog registry),
EPIC-1011 (chart studies resolve through the catalog registry)
**Design**: docs/design/discovery-and-catalog/

## Description

An agent driving a screener has to name things before it can do anything:
which instrument, which field, which operator, which study, which interval.
Today it can only guess, and a guess that looks plausible ("RSI14",
"AAPL") is indistinguishable from one that is wrong. This epic delivers the
three read-only discovery tools from `docs/reference/tool-spec.md` —
`search_instruments`, `search_catalog`, `describe_catalog_item` — plus the
**catalog registry** they read from: the typed, stable-ID inventory of
fields, operators, studies, indicators, patterns, intervals, universes, and
templates that the rest of the new WebMCP surface validates against. Done
looks like: an agent can go from free text ("Apple", "relative volume",
"crossed above") to canonical IDs with declared parameters, units, valid
ranges, defaults, outputs, and data availability, without ever inventing an
identifier.

This epic is part of the full-replacement WebMCP surface. Everything it
delivers lives in **new files**; the existing 11-tool pattern-research
surface (`src/lib/webmcp/tools.ts`, `src/lib/workspace/*`) is not modified,
and is retired separately by EPIC-1015.

## User Story

As an AI agent operating the screener through WebMCP,
I want to resolve free-text names into canonical instrument and catalog IDs
and read each item's parameters, units, ranges, defaults, outputs, and data
availability,
so that every later tool call I make uses identifiers the app actually
recognizes, and I can tell the difference between "not supported" and "not
available yet".

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1008-1 | Discovery result envelope, provenance, and stable-ID scheme | — | Open |
| 2 | T-1008-2 | Catalog registry: typed item model and seeded inventory | T-1008-1 | Open |
| 3 | T-1008-3 | Instrument directory port and reference-data seam | T-1008-1 | Open |
| 4 | T-1008-4 | `search_instruments` tool | T-1008-1, T-1008-3 | Open |
| 5 | T-1008-5 | `search_catalog` tool | T-1008-2 | Open |
| 6 | T-1008-6 | `describe_catalog_item` tool | T-1008-2 | Open |
| 7 | T-1008-7 | Register the discovery tool group on the new surface | T-1008-4, T-1008-5, T-1008-6 | Open |

## Dependency Graph

```
T-1008-1 ──┬──> T-1008-2 ──┬──> T-1008-5 ──┐
           │               │               │
           │               └──> T-1008-6 ──┤
           │                               ├──> T-1008-7
           └──> T-1008-3 ──> T-1008-4 ─────┘
```

## Wave Plan

- **Wave 1**: T-1008-1 — the envelope and ID scheme everything else returns
  and produces.
- **Wave 2** (parallel): T-1008-2, T-1008-3 — the two independent data
  surfaces (in-repo catalog registry; external instrument directory port).
- **Wave 3** (parallel): T-1008-4, T-1008-5, T-1008-6 — one tool each.
- **Wave 4**: T-1008-7 — wiring: the three tools become one registrable
  group on the new surface.

## Acceptance Criteria

1. Free text naming a company or ticker resolves to zero or more candidate
   instruments, each carrying a canonical instrument ID, exchange, asset
   type, country, currency, and listing status — and the ID is never a bare
   ticker symbol.
2. A search across the catalog returns matching items of any kind (field,
   operator, study, indicator, pattern, interval, universe, template), each
   with its stable ID, kind, label, and a short description, and can be
   narrowed to specific kinds.
3. Asking about one catalog item by ID returns its parameters (with value
   types, units, defaults, and valid ranges), its outputs, and its data
   availability.
4. Every result from all three tools carries provenance: `as_of`, source,
   live/delayed status, timezone, and — where the payload is
   monetary/price/fundamental — currency, price-adjustment policy, and
   fundamentals reporting period, plus the calculation-engine version.
5. When a catalog item or instrument search depends on reference data that
   the separate live-data workstream has not yet supplied, the tool returns
   a well-formed result that explicitly reports the data as unavailable and
   why — it does not fail, and it does not present placeholder data as real.
6. Requesting an unknown catalog item ID or an unknown instrument ID returns
   an explicit not-found result naming the ID, not an empty success.
7. The catalog registry is exported as a typed, read-only inventory that
   other epics can query by ID and by kind: EPIC-1009 can determine whether
   a given operator is valid for a given field, and EPIC-1011 can resolve a
   study ID to its parameter and output definitions.
8. All three tools are read-only: no call mutates workspace, screener, or
   catalog state, and none of them require or accept a mutation envelope.
9. The existing 11-tool surface and its workspace store are unchanged, and
   `main` remains deployable throughout the epic.

## Design References

- `docs/reference/tool-spec.md` — the source of truth for the three tool
  descriptions, the eight `edit_filter_tree` condition types the operator
  catalog must cover, the "stable IDs — never a bare ticker" rule, and the
  market-data provenance requirement.
- `docs/design/discovery-and-catalog/spec.md` — this epic's behavioral spec.
- `docs/design/discovery-and-catalog/technical.md` — the catalog registry
  model, the instrument-directory port, and the provenance envelope.
- `src/lib/webmcp/types.ts` — existing `ToolSpec` / `ToolResult` shape the
  new tools' registration must match.
- `src/lib/webmcp/tools.ts` — existing tool-authoring conventions (`ok` /
  `fail` result shaping, `available` predicates, JSON-schema style).
- `backend/domain/contracts/engine.py`,
  `backend/domain/models/universe.py` — existing port and reference-metadata
  conventions on the Python side; `TickerMetadata` is the closest thing the
  repo has today to instrument reference data.
- `docs/reference/data-provider.md` — why sector/market-cap/earnings
  metadata is sourced outside the OHLCV pipeline, which is the same seam
  T-1008-3 formalizes.

## Out of Scope

- **Building the reference/fundamental data itself.** Sectors, industries,
  indexes, exchanges, countries, fundamentals, and earnings calendars have
  no source and no owner — sourcing them is an open project decision. This
  epic defines the port such a source would implement against and nothing
  more — no ingestion, no mock data pipeline, no fixture dataset
  masquerading as real reference data.
- Mutation tooling of any kind (`expected_revision`, `idempotency_key`,
  `undo_token`) — these three tools are read-only. EPIC-1006 owns that.
- `create_computed_field` and `create_custom_study` — user-authored catalog
  entries. This epic's registry is read-only and built-in; it is designed to
  be extended later, but the extension tools are not delivered here.
- Retiring the existing 11 tools (EPIC-1015).
- Any UI. The catalog is agent-facing; rendering it in a `study_library`
  panel belongs to the panel epic.
