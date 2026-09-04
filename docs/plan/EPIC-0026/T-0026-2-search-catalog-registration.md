# T-0026-2: `search_catalog` registration + sector enumeration

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/discovery-and-catalog/
**Status**: Done
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

## Solution Approach

**Registration (AC1).** Added `registerSearchCatalogTool()` to
`searchCatalog.ts`, mirroring `resolveTicker.ts`'s existing single-tool
`registerXTool()` pattern (`ensureModelContext()` + `mc.registerTool(...)`)
rather than pulling in `buildDiscoveryTools`' full three-tool group — that
group also builds `search_instruments`/`describe_catalog_item` against an
`InstrumentDirectory` this ticket has no reason to wire up.
`workbenchCompositionRoot.ts`'s `registerWorkbenchComposition()` now calls
it alongside the existing `registerResolveTickerTool()` call — one new
line plus a defaulted-registry import, nothing else in that file touched.
T-0026-3 folds this into its exact-seven-tool MVP registration pass.

**Enumerated field values (AC2/AC3).** `search_catalog`'s summary row
gained one conditional key: `enumValues`, present only when
`item.kind === 'field' && item.enumValues` is truthy, taken verbatim from
`FieldItem.enumValues` (already declared in `catalog/types.ts`, just never
populated for `field.sector` and never surfaced by the row). Every other
kind's row is byte-for-byte unchanged — no new key, not even a `null` one
— which is what AC3 asks for literally ("returns unchanged").
`field.sector` now declares `enumValues: SECTOR_ENUM_VALUES` in
`catalog/items.ts`.

**AC4 — the sector value source, and the risk this surfaces.** I looked
for a canonical, shared list of accepted sector values and did not find
one:
- `src/lib/screener/universeValidation.ts` treats `sectors` as one of four
  "unverifiable" universe dimensions — stored as given, never checked
  against anything, because no reference-data source is wired in.
- The backend (`backend/infra/nasdaq_screener.py`) has no sector enum at
  all: `TickerMetadata.sector` is whatever string sits in the "Sector"
  column of a periodically-refreshed Nasdaq screener CSV export.
- EPIC-0025's own T-0025-1 ticket (`sectors` universe narrowing, in
  progress in a sibling worktree at the time of writing) confirms this
  directly: a requested sector is validated against "the loaded metadata"
  at runtime — an open, data-driven set — not a compiled schema. There is
  no fixed vocabulary on the backend side to check a frontend-declared
  list against.

Given no canonical source exists, I populated `SECTOR_ENUM_VALUES` with
the classic twelve-category Nasdaq screener taxonomy (Basic Industries,
Capital Goods, Consumer Durables, Consumer Non-Durables, Consumer
Services, Energy, Finance, Health Care, Miscellaneous, Public Utilities,
Technology, Transportation) — the taxonomy that export's "Sector" column
has used for years, and the one visible piece of real evidence in this
repo (`backend/tests/unit/test_universe_eligibility.py`'s fixture CSV
uses "Technology", "Health Care", "Finance" from exactly this list).
I also corrected `field.sector`'s description, which previously said
"GICS-style sector classification" — the real source is Nasdaq's
taxonomy, not GICS; the two use different category names and counts.

**This is a best-effort seed, not a verified guarantee.** AC4 asks for a
value `search_catalog` offers to be "guaranteed" accepted by the screener
endpoint. That guarantee is not achievable today: the backend's accepted
set is an open, runtime CSV-driven set with no compiled counterpart to
check against, and EPIC-0025 hasn't shipped yet. The tests added here
prove internal consistency (`search_catalog`'s row matches
`items.ts`'s own `SECTOR_ENUM_VALUES`) and prove the general
enumValues-passthrough mechanism against a synthetic field, but cannot
and do not claim to prove backend acceptance. **Flagged for review**: once
EPIC-0025 ships, revisit whether `SECTOR_ENUM_VALUES` should be sourced
from a real endpoint (e.g. a distinct-values read over the loaded universe
metadata) instead of a hardcoded list, so the two surfaces cannot drift
apart silently.

**Files touched**: `src/lib/catalog/items.ts` (declare
`SECTOR_ENUM_VALUES`, populate `field.sector.enumValues`),
`src/lib/webmcp/discovery/searchCatalog.ts` (row shaping +
`registerSearchCatalogTool`), `src/lib/webmcp/discovery/searchCatalog.test.ts`
(AC2/AC3/AC4/AC1 coverage), `src/lib/workbench/composition/workbenchCompositionRoot.ts`
(one additive registration call), `src/lib/workbench/composition/workbenchCompositionRoot.test.ts`
(assert `search_catalog` is in the registered set).
