# T-0026-3: Full instrument ref on screener result rows

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/screener-core/
**Status**: Done
**Depends on**: T-0026-1, T-0026-2
**Blocks**: T-0026-5 (composition root wires this shape into the registered `get_screener_results`)
**Resolves**: #26

## Description

_This ticket was split out of a larger "evaluation port, result rows,
retention, and composition root" ticket after a first implementation
attempt widened `ScreenerMatch` without updating its callers, fixtures, or
the composition root — 17 typecheck errors, reverted rather than merged.
The four changes are independent enough to land safely on their own; this
one is the data-shape change alone._

`ScreenerMatch` (`src/lib/screener/run.ts`) carries only a bare
`instrumentId: string` per match. `get_screener_results` rows inherit that.
Both the agent path (create a chart from a result row via
`get_screener_results` → `create_panel`) and the human path (EPIC-0027's
drag-to-chart) need a full instrument reference to act on a row without a
second lookup — EPIC-0027 already shipped a workaround, minting a
provisional `exchange: 'XUNK'`/`assetType: 'equity'` placeholder because
this didn't exist yet.

This ticket extends `ScreenerMatch` to carry `symbol`, `exchange`,
`assetType`, and `name` alongside `instrumentId`, sources those fields at
evaluation time (from EPIC-0025's response, which already returns a full
ref per row — see `backend/domain/models/screener_run.py`), and updates
every caller, test, and fixture that constructs a `ScreenerMatch` today.

## User Story

As the agent screener loop,
I want each result row to carry a complete instrument reference,
so that a chart can be created directly from a result without guessing or
fabricating a placeholder ref.

## Acceptance Criteria

1. `ScreenerMatch` gains `symbol: string`, `exchange: string`,
   `assetType: string`, `name: string`, alongside the existing
   `instrumentId`.
2. `get_screener_results` rows expose all five fields (`instrument_id`,
   `symbol`, `exchange`, `asset_type`, `name`) on the wire.
3. The frontend `ScreenerEvaluationPort` implementation(s) — the existing
   in-browser engine and any new HTTP-backed one — populate these fields
   from the data they already have (EPIC-0025's endpoint already returns a
   full ref per match; the in-browser engine derives it from
   `instrument_id`'s `inst:<MIC>:<SYMBOL>` shape, same as
   `resolveTicker.ts` already does, with `assetType` assumed `'equity'`
   absent a reference-data source — same honest limitation
   `resolveTicker.ts` documents, not a new one).
4. Every existing caller, test fixture, and mock that constructs a
   `ScreenerMatch` literal is updated to the new shape — this is the
   specific gap the reverted first attempt left open; a build with zero
   typecheck errors is required evidence, not merely a passing test file.
5. No change to `run_screener`'s port wiring, retention behavior, or the
   composition root — those are T-0026-4/5/6.

## Solution Approach

**Type widening (`src/lib/screener/run.ts`)**: `ScreenerMatch` gains
`symbol: string`, `exchange: string`, `assetType: string`, `name: string`
right after `instrumentId`. `toWireScreenerMatch` emits them as
`instrument_id, symbol, exchange, asset_type, name` (matching AC2's field
order), before `rank`/`composite_score`/etc.

**New shared parser (`src/lib/surface/ids.ts`)**: `makeInstrumentId` already
owns the `inst:<MIC>:<SYMBOL>` grammar; add its inverse,
`parseInstrumentId(value): { exchangeMic, symbol } | null`, returning `null`
for anything that doesn't match `INSTRUMENT_ID` rather than throwing. Domain
layer, so `screener/engine` (infra) may import it without a layering
violation (`catalog/types.ts` already does).

**In-browser engine (`src/lib/screener/engine/engine.ts`)**: a small
`deriveInstrumentRef(instrumentId)` helper calls `parseInstrumentId`; when it
parses, `symbol`/`exchange` come from the id, otherwise `symbol` falls back
to the raw instrumentId and `exchange` to `'XUNK'` (mirrors
`resolveTicker.ts`'s provisional-unknown-exchange convention, needed because
`engine.test.ts`'s fixtures use bare ids like `I1`, not the `inst:` shape).
`assetType` is always `'equity'` and `name` always equals `symbol` -- both
honest placeholders, since this project has no reference-data source
anywhere (`src/lib/discovery/ports.ts`, `resolveTicker.ts`) to source a real
asset classification or company name from. `execute()`'s match-building map
spreads this helper's result into each `ScreenerMatch` literal.

**`get_screener_results` wire rows (`src/lib/results/domain/page.ts`)**:
`ResultRow` gains the same four fields, sourced directly from the
`ScreenerMatch` passed into `buildRow` (not through the existing
`TickerResolver`/`ticker` mechanism, which stays untouched -- it is a
separate, already-shipped display-ticker lookup this ticket does not touch
or remove). `toWireResultRow` emits `symbol, exchange, asset_type, name`
alongside the existing fields. `ProjectedRow` (`projection.ts`) inherits them
for free since it extends `ResultRow`.

**Fixture/caller updates**: every literal that constructs a `ScreenerMatch`
or a `ResultRow`/`ProjectedRow` across production and test code gets the new
fields. Enumerated by grepping for `ScreenerMatch`, `nodeEvaluations:`,
`compositeScore:`, and `resultId:` repo-wide (not just files that mention
`ScreenerMatch` by name, since several test files build the shape inline
without importing the type) -- this is the exact gap the reverted first
attempt left open (see Description).

## Out of Scope

- `HttpScreenerEvaluationPort` itself — T-0026-4.
- Composition-root registration — T-0026-5.
- Retention policy, engine deletion, status doc — T-0026-6.
- Updating EPIC-0027's `resultRowDrag.ts` to consume the real ref instead
  of its placeholder — follow-up on EPIC-0027, not this epic.
