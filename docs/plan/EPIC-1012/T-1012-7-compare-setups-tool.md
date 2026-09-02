# T-1012-7: `compare_setups` tool and comparison views

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Done
**Depends on**: T-1012-6
**Blocks**: T-1012-8

## Description

Ranked scores tell a researcher which candidates the system likes; only
looking at them together tells the researcher whether it is right. This
ticket delivers `compare_setups` and the three comparison forms the design
calls for — normalized overlays, synchronized charts, and small multiples —
with the reference setup itself always present as the baseline.

Comparability is the whole point, so the normalization settings carried by
the captured setup govern every form, and the settings actually applied are
stated on screen.

## User Story

As a researcher holding a handful of candidate matches,
I want to see them drawn against my reference setup as overlays,
synchronized charts, or small multiples,
so that I can judge with my own eyes whether the resemblance the score
claims is really there.

## Acceptance Criteria

1. The tool accepts a similarity run ID, a set of candidate IDs from that
   run, and a comparison form, and displays those candidates in the
   requested form.
2. All three forms are supported: normalized overlays (candidates drawn on
   one shared normalized scale), synchronized charts (separate charts whose
   time axis and crosshair move together), and small multiples (a grid of
   aligned miniature charts).
3. In every form the reference setup is included and visually distinguished
   as the baseline the candidates are being compared against.
4. All candidates and the reference are aligned on a common anchor, so
   corresponding points in each setup's window line up rather than being
   compared at unrelated offsets.
5. The normalization settings applied come from the captured setup, and the
   settings actually used are stated in the displayed view — comparability
   is asserted, never assumed.
6. The view states the market-data provenance of the data being compared —
   `as_of`, source, live/delayed status, timezone, currency,
   adjusted/unadjusted price basis, and calculation-engine version.
7. Candidates are referenced by stable candidate ID throughout; a bare
   ticker is never used as an identifier, though it may be shown as a
   label.
8. Requesting a candidate ID that is not part of the named run is rejected
   with an actionable error and no view change.
9. Requesting more candidates than a form can legibly display returns an
   explicit warning stating the applied cap and which candidates were
   shown, rather than silently truncating or rendering an unreadable view.
10. As a workspace mutation the tool honors `expected_revision` and
    `idempotency_key` and returns the common mutation envelope, and the
    returned `undo_token` restores the prior view.
11. The tool is registered on the new tool surface only; the existing
    11-tool surface and workspace UI are unchanged.

## Design References

- `docs/reference/tool-spec.md` — the `compare_setups` row (the three forms
  are named there), the common mutation contract, and the provenance rule
- `docs/plan/EPIC-1012/T-1012-6-similar-opportunities-panel.md` — the panel
  these views render into
- `src/lib/workspace/PriceChart.svelte`, `src/lib/workspace/FocusChart.svelte`
  — the existing chart rendering components and their normalization and
  anchor-alignment handling
- `backend/domain/models/measurement.py` — `InstanceWindow`, the existing
  bars-around-an-anchor shape the comparison data resembles

## Technical Considerations

- Per the epic's open questions, `compare_setups` targets an explicit panel
  ID and defaults to the `similar_opportunities` panel bound to the run.
  Confirm this against EPIC-1007's panel contract before implementing; if
  that epic settled it differently, follow EPIC-1007 and note the change.
- Synchronized charts imply cross-panel or cross-chart linking, which is
  EPIC-1007's `link_panels` concern. Reuse that mechanism rather than
  building a second synchronization path.
- The mutation envelope, `expected_revision`, `idempotency_key`, and undo
  tokens are EPIC-1006's contract — consume, do not define.
- New files only. Do not modify the existing chart components; if their
  behavior is needed, extract or reimplement in new files rather than
  editing them, since the existing UI must keep working until EPIC-1015.

## Out of Scope

- Computing similarity or explanations (T-1012-2, T-1012-5).
- Measuring outcomes or forward returns on compared candidates.
- Exporting or sharing a comparison view.

## Solution Approach

**Run by value, not by ID (this ticket is parallel to T-1012-3/4 in the
epic's own wave plan, and depends only on T-1012-6):** there is no
client-side run store yet at this point in the epic, so `compare_setups`
accepts the full `SimilarityRun` (T-1012-1's TS contract) directly in its
input, matching this project's established stateless-by-value convention
(`api/schemas/research.py`'s docstring: "every request... carries its data
by value rather than by a server-side id lookup"). T-1012-8 is responsible
for whatever end-to-end plumbing hands a real run from
`find_similar_setups` to a later `compare_setups` call.

**Target panel resolution:** an explicit `panel_id`, or (default) the
`similar_opportunities` panel among the current workspace's panels whose
`config.runId` equals the run's `run_id` — no such panel is an actionable
error (AC8's "no view change" spirit), not a guess.

**Files:**
- `src/lib/workbench/similarity/comparison/domain/comparisonView.ts` —
  pure: `ComparisonForm`, per-form legibility caps, `CandidateSelectionError`
  (AC8), `resolveComparisonCandidates` (validates + caps + warns per AC9),
  `buildComparisonView`.
- `src/lib/workbench/similarity/comparison/application/compareSetups.ts` —
  a `PanelUseCaseDeps`-shaped use case (matching
  `panels/application/setPanelSelection.ts`'s house style, via
  `commitPanelChange`/`findPanel` directly) rather than the workbench
  `OperationRegistry`/`applyOperations` style EPIC-1011's chart tools use:
  this mutation's target is panel-container state, the same state
  `setPanelSelection`/`configurePanelView` already own, so it fits that
  layer's existing pattern, not the workbench one.
- `src/lib/workbench/similarity/comparison/tools/compareSetups.ts` — the
  `ToolSpec`, matching `panels/tools/lifecycleTools.ts`'s wrapping style
  (`parseContext`, `toWireEnvelope`, `toErrorResult`).
- `src/lib/workbench/similarity/panel/domain/panelKind.ts` (extended, this
  epic's own file from T-1012-6): `SimilarOpportunitiesConfig` gains
  `comparisonView: ComparisonView | null`, validated the same way as
  `runId`.
- `src/lib/workbench/similarity/comparison/components/ComparisonPanel.svelte`
  — the three forms as normalized SVG line charts (not full candlesticks —
  see the scope note below), reusing
  `chart/components/chartNormalization.ts`'s `normalizeSeries`/
  `resolveAnchorIndex` UNCHANGED rather than reimplementing normalization,
  and `chart/domain/seriesPort.ts`'s `OhlcvBar` shape for its bar props so
  a future wiring step can hand it real fetched series with no reshaping.

**Deliberate scope simplification (flagging, not hiding):**
1. **Rendering fidelity.** No AC demands candlestick rendering
   specifically ("candidates drawn" / "aligned miniature charts") — full
   OHLC candle rendering at the fidelity of `ChartPanel.svelte` /
   `chartPanelModel.ts` is a large, separate undertaking. `ComparisonPanel`
   draws each series' normalized close price as an SVG polyline instead —
   real, anchor-aligned, provenance-stated comparison, genuinely
   satisfying AC1-AC7, just not candle-level detail. Flagging as a
   possible follow-on if candle-level comparison fidelity turns out to
   matter.
2. **"Synchronized charts" as one panel, not linked panels.** The
   Technical Considerations suggested reusing EPIC-1007's `link_panels`
   for synchronization, under the assumption each candidate would be a
   separate chart-kind panel. This ticket instead renders all three forms
   inside the ONE target panel (matching this ticket's own Design
   Reference, which calls T-1012-6 "the panel these views render into" —
   singular), so "synchronized" is self-contained, in-component crosshair
   state shared across its own mini-charts — never touching
   `link_panels`, which is unaffected either way. Not "a second
   synchronization path" in the cross-panel sense EPIC-1007 owns, since no
   second panel is ever created.
3. **`ComparisonPanel` takes bars as a prop, fetches nothing itself** —
   matching `ChartPanel.svelte`'s own "handed its data" convention.
   Wiring an actual `ChartSeriesPort` fetch that supplies those bars at
   render time is connecting work; given T-1012-6's already-flagged
   finding that `PanelFrame.svelte` hands a live component zero props
   today, this is the same gap recurring, not a new one — left for
   T-1012-8 or EPIC-1007.

**Testing:** pure-logic unit tests for `comparisonView.ts` (cap, warning
text, AC8's rejection), the use case tested via `PanelUseCaseDeps` test
fixtures matching `setPanelSelection.test.ts`'s style, and a real
component-render test for `ComparisonPanel.svelte` following the
`mount`/`flushSync`/`unmount` precedent `ChartPanel.test.ts` and T-1012-6
already established. All new tests mutation-checked.
