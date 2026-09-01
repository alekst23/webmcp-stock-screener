# T-1008-1: Discovery result envelope, provenance, and stable-ID scheme

**Epic**: EPIC-1008 (Discovery & Catalog)
**Design**: docs/design/discovery-and-catalog/
**Status**: Open
**Depends on**: —
**Blocks**: T-1008-2, T-1008-3

## Description

`.dev/design/tool-spec.md` requires that every market-data result state
`as_of`, source, live/delayed status, timezone, currency, adjusted or
unadjusted prices, fundamentals reporting period, and the
calculation-engine version — and that every resource be addressed by a
stable ID, never "panel 3" or a bare ticker. Those two rules are shared by
every tool in the new surface, so they are built once, here, before any
tool exists to use them. Done looks like: a single typed wrapper any
discovery result can be returned inside, and one place that constructs and
validates the ID strings the whole surface passes around.

## User Story

As a developer building any tool in the new WebMCP surface,
I want one typed provenance-carrying result wrapper and one stable-ID
helper,
so that provenance and identifier discipline are structurally enforced
rather than re-remembered in every tool.

## Acceptance Criteria

1. A result wrapper carries a typed payload alongside a provenance record
   and a list of non-fatal warnings.
2. The provenance record always states an `as_of` timestamp, a source
   identifier and human-readable label, a delivery status distinguishing
   live from delayed from end-of-day from static reference data, an IANA
   timezone, and the calculation-engine version.
3. When delivery is delayed, the provenance record states the delay
   magnitude.
4. The provenance record can additionally state an ISO-4217 currency, a
   price-adjustment policy (adjusted, unadjusted, or not applicable), and a
   fundamentals reporting period (basis, period end, fiscal year, fiscal
   quarter); each is absent rather than guessed when the payload has no
   monetary, price, or fundamental content.
5. Constructing a provenance record without an `as_of`, source, timezone, or
   engine version is impossible — the type does not permit it.
6. A stable ID is produced for each identifier family the epic introduces
   (instrument, catalog item), is a namespaced string rather than a bare
   symbol, and is documented as opaque to callers.
7. Given a string, a checker reports whether it is a well-formed ID of a
   given family, so a bare ticker passed where an instrument ID is expected
   is detectable rather than silently accepted.
8. The calculation-engine version reported in provenance comes from a single
   declared value, so every tool in the surface reports the same version.
9. Unit tests cover: a minimal provenance record round-tripping through the
   wrapper; a delayed record reporting its delay; an omitted currency /
   price-adjustment / reporting-period staying absent rather than
   defaulting; a bare ticker being rejected by the instrument-ID checker;
   and a well-formed ID of each family being accepted.

## Design References

- `.dev/design/tool-spec.md` — "Common contract for every tool": the
  stable-ID rule and the market-data provenance list this ticket encodes.
- `docs/design/discovery-and-catalog/technical.md` — the envelope and ID
  contracts.
- `src/lib/webmcp/types.ts` — existing type-declaration conventions to
  match (interfaces, comment style, no runtime dependency on infra).

## Technical Considerations

- New files only. Nothing in `src/lib/webmcp/tools.ts`,
  `src/lib/webmcp/types.ts`, or `src/lib/workspace/` is modified.
- This is a domain-layer module: pure types plus small pure constructors and
  validators. It must not import anything that performs I/O.
- Sibling epics will also need this envelope. Export it from a location that
  reads as surface-wide rather than discovery-specific, and keep it free of
  catalog- and instrument-specific concepts.
- Delivery status must distinguish "static reference data" from "end of
  day"; the catalog itself is static, while an instrument directory is not.

## Out of Scope

- The mutation envelope (`change_id`, `new_revision`, `undo_token`) — that
  is EPIC-1006's, and read-only tools never return it.
- Any actual data source, catalog content, or tool.
