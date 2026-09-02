# T-1008-2: Catalog registry — typed item model and seeded inventory

**Epic**: EPIC-1008 (Discovery & Catalog)
**Design**: docs/design/discovery-and-catalog/
**Status**: Done
**Depends on**: T-1008-1
**Blocks**: T-1008-5, T-1008-6

## Solution Approach

Three new domain modules, with data and query logic deliberately separated
so a real data source can later contribute availability records without
touching how the catalog is searched.

- `src/lib/catalog/types.ts` — the item model. `CatalogItem` is a
  discriminated union on `kind`, so an entry missing its kind's required
  fields does not compile (AC12). `DataAvailability` is likewise a union:
  `status: 'partial' | 'unavailable'` **requires** a `reason`, making
  "unavailable, no explanation" unrepresentable.
- `src/lib/catalog/items.ts` — the seeded inventory: 5 intervals, 17
  fields, 12 operators spanning all eight condition families, 7 studies, 3
  indicators, 3 patterns, 4 universes, 3 templates.
- `src/lib/catalog/registry.ts` — `getCatalogItem`, `listCatalogItems`,
  `searchCatalogItems`, `isOperatorValidForField`, `resolveStudy`, plus
  `clampCatalogLimit` and `suggestCatalogIds` (T-1008-6's self-correction
  hint). The inventory is `Object.freeze`d at module load, so a caller
  cannot corrupt an item two sibling epics also hold.

**What `availability` means.** It answers "can an agent use this today?",
and the `reason` says which kind of no it is: no data source, no engine
support, or no consuming tool yet. An agent that cannot tell "unsupported"
from "not wired up" retries forever. So: daily OHLCV fields, `interval.1d`
and the studies the expression engine really implements (`sma`, `ema`,
`atr`) are available; RSI/MACD/Bollinger are declared but unavailable
pending engine support; VWAP and intraday intervals are unavailable for
want of intraday data; the reference-data fields and index universes are
unavailable with `requiresReferenceData: true`. Nothing claims data it does
not have.

Ranking is a fixed ladder (exact ID, exact label, exact alias, prefix,
substring, tag, description) with ties broken on ID — predictable rather
than tuned, because an agent that cannot anticipate ordering re-queries
instead of trusting it. An empty text query is enumeration, reported as
`matchedOn: 'enumeration'` rather than attributed to a field that played no
part.

Tests: `registry.test.ts`. Mutation-checked — dropping `Object.freeze`,
removing the `includeUnavailable` filter, and making the operand-type check
always pass each turn their tests red.

## Description

The catalog registry is the typed inventory of everything the screener
knows how to name: fields, operators, studies, indicators, patterns,
intervals, universes, and templates. It is the single source of truth that
`search_catalog` and `describe_catalog_item` read from, that EPIC-1009's
`edit_filter_tree` validates conditions against, and that EPIC-1011's
chart-renderer contract (reached through `configure_panel_view`) resolves
study IDs through. Done looks like: a
read-only, well-typed export that answers "what exists", "what is item X",
"is operator O valid on field F", and "what does study S take and produce".

## User Story

As the rest of the WebMCP surface (this epic's tools, EPIC-1009's filter
tree, EPIC-1011's chart studies),
I want one typed registry of every nameable item with its parameters,
units, ranges, defaults, outputs, and availability,
so that validation and resolution happen against a declared inventory
instead of hard-coded string lists scattered across tools.

## Acceptance Criteria

1. Every catalog item, regardless of kind, carries a stable ID, its kind, a
   display label, a short description, searchable aliases, tags, and a data
   availability record.
2. The registry represents all eight kinds named in the tool spec: field,
   operator, study, indicator, pattern, interval, universe, and template.
3. A field item declares its value type, its unit where one applies, its
   valid range or enumerated values where those apply, whether it can be
   null, and — for fundamentals — its reporting basis.
4. An operator item declares its arity, the operand value types it accepts,
   and which of the tool spec's condition families it belongs to (scalar,
   range, series comparison, temporal, event-relative, pattern, relative,
   study output).
5. Study, indicator, and pattern items each declare a parameter list — each
   parameter with a value type, unit where applicable, default value, and
   valid range or enumerated values — and an output list, each output with a
   value type and unit where applicable.
6. An interval item declares its bar duration and whether it is
   session-aware; a universe item declares where its membership comes from;
   a template item declares what it applies to.
7. A data availability record states whether the item is available,
   partially available, or unavailable; the reason when it is not fully
   available; and explicitly whether it depends on reference data this
   project has no source for.
8. Items that depend on reference data not yet supplied (sector, industry,
   index, country, exchange, fundamentals, and earnings-calendar fields and
   universes) are present in the registry and marked unavailable with a
   reason — they are not omitted, and they do not claim availability.
9. The registry can be queried by ID, listed by kind, and listed in full;
   the returned structures cannot be mutated by callers.
10. Given an operator ID and a field ID, the registry reports whether that
    operator is valid for that field, so EPIC-1009 can validate conditions
    without re-deriving type rules.
11. Given a study ID, the registry returns that study's parameter and output
    definitions, so EPIC-1011 can resolve and validate study configuration.
12. Adding a new item of any kind requires only adding a registry entry —
    no change to the query functions, and the compiler rejects an entry
    missing required fields for its kind.
13. Every registry ID is unique, and a test asserts this over the whole
    inventory rather than by inspection.
14. Unit tests cover: lookup of a known ID; lookup of an unknown ID;
    listing by each kind; operator/field validity for a matching and a
    mismatching pair; study resolution; the uniqueness assertion; and that a
    reference-data-dependent item reports unavailable with a reason.

## Design References

- `docs/reference/tool-spec.md` — the eight catalog kinds `search_catalog`
  must cover; the eight `edit_filter_tree` condition types the operator
  entries must span; the study examples (MA, RSI, MACD, Bollinger Bands,
  VWAP, ATR) EPIC-1011's chart-renderer contract names; the
  `set_screener_universe`
  dimensions the universe entries must cover.
- `docs/design/discovery-and-catalog/technical.md` — the catalog item type
  model and query surface.
- `src/lib/webmcp/types.ts` — `FUNCTION_CATALOG` and its comment: the
  existing precedent for a small declared catalog exported for client-side
  validation, and the reasoning about keeping it in sync by hand.
- `backend/domain/models/universe.py` — `TickerMetadata`, the existing
  sector/market-cap classification shape the reference-data-dependent field
  entries correspond to.

## Technical Considerations

- New files only. `src/lib/webmcp/tools.ts` and `src/lib/workspace/` are
  untouched.
- The seeded inventory must be substantial enough to be useful and honest,
  not exhaustive: cover the studies and condition families the tool spec
  names by example, plus the price/volume fields the existing engine already
  supports, plus the reference-data fields marked unavailable. Breadth of
  *kinds* matters more than depth within a kind.
- Two sibling epics consume this. Treat the query functions as a published
  contract: narrow, total, and free of tool- or UI-specific concepts.
- The study-versus-indicator boundary is not defined by the tool spec. See
  the Open Questions in `docs/design/discovery-and-catalog/spec.md` for the
  assumption this ticket implements; if implementation reveals the split is
  not carrying its weight, record that rather than silently merging them.
- Registry data and registry query logic should be separable, so a real
  data source can later contribute or override availability records without
  touching the query surface.

## Out of Scope

- User-authored catalog entries (`create_computed_field`,
  `create_custom_study`).
- Actually evaluating a study or operator — the registry declares what
  exists and what it takes, not how it computes.
- Sourcing real availability windows — nothing supplies them and nobody
  owns doing so; this ticket declares the availability shape and seeds
  honest placeholders that say "unavailable, no reference-data source".
