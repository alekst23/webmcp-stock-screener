# T-0026-3: Full instrument ref on screener result rows

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/screener-core/
**Status**: Not started
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

## Out of Scope

- `HttpScreenerEvaluationPort` itself — T-0026-4.
- Composition-root registration — T-0026-5.
- Retention policy, engine deletion, status doc — T-0026-6.
- Updating EPIC-0027's `resultRowDrag.ts` to consume the real ref instead
  of its placeholder — follow-up on EPIC-0027, not this epic.
