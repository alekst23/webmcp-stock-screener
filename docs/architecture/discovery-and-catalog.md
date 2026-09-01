# Discovery & Catalog

This doc covers the naming and lookup layer of the new WebMCP surface: how
an agent goes from free text to canonical, typed identifiers it can use in
every other tool call. Delivered by EPIC-1008. Read `new-webmcp-surface.md`
first for the program-wide context this fits into.

## The problem

Every other tool in the new surface — screener filters, chart studies,
similarity search — takes IDs as input: which instrument, which field,
which operator, which study. An agent that has to guess those IDs produces
plausible-looking garbage indistinguishable from a correct call ("RSI14",
"AAPL" as a bare ticker). Discovery exists so nothing downstream has to
guess.

## The catalog registry

A typed, in-memory, read-only inventory of every non-instrument thing the
surface can name: fields, operators, studies, indicators, patterns,
intervals, universes, and templates. Each item carries a stable ID (see
`new-webmcp-surface.md`'s ID scheme), a kind, a label, a description,
parameters (with types, units, defaults, valid ranges), outputs, and data
availability.

The registry is deliberately split into two layers:

| Layer | File | Responsibility |
|-------|------|-----------------|
| Data | `src/lib/catalog/items.ts` | The static inventory — one array literal, grouped by kind |
| Query | `src/lib/catalog/registry.ts` | Search, kind-filtered lookup, and the two typed queries other epics consume: `isOperatorValidForField`, `resolveStudy` |

Sibling epics query the registry, they don't reimplement catalog logic:
EPIC-1009 (screener core) calls `isOperatorValidForField` to validate a
filter condition; EPIC-1011 (charts) calls `resolveStudy` to resolve a study
ID to its parameter/output definitions.

## Instrument resolution

Free text ("Apple", "AAPL") resolves to zero or more candidate instruments
through the `InstrumentDirectory` port (`src/lib/discovery/ports.ts`) — a
narrow interface a reference-data source implements. No such source exists
yet in this repo (see "reference-data" blocker in `docs/plan/project.md`),
so the only shipped implementation today is
`src/lib/discovery/unavailableDirectory.ts`: it doesn't fail and doesn't
fabricate data — it returns a well-formed result that explicitly reports
the data as unavailable, distinguishing "not supported" from "not
available yet."

## The three tools

`search_instruments`, `search_catalog`, and `describe_catalog_item`
(`src/lib/webmcp/discovery/`) are the only consumers of the registry and
the directory port from WebMCP. All three are read-only — no mutation
envelope, no `expected_revision`, no `idempotency_key` — and are composed
into one registrable group by `buildDiscoveryTools(deps)`
(`src/lib/webmcp/discovery/group.ts`), which takes the directory
implementation as a parameter so tests can supply a fixed fixture directory
instead of the unavailable default.

## References

- `new-webmcp-surface.md` — the program-wide composition model this epic's
  tools plug into
- `docs/design/discovery-and-catalog/spec.md`,
  `docs/design/discovery-and-catalog/technical.md` — full behavioral spec
  and technical design
- `docs/reference/tool-spec.md` — the three tool descriptions and the
  common contract
