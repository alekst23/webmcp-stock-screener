# T-1015-13: Restore the full new-surface tool registration

**Epic:** EPIC-1015
**Status:** Open

## Goal

During epic-close hardening (2026-09-03), the app's tool surface was
deliberately trimmed to a chart-only demo set (`registerPanelTools` +
`registerChartTools` + the new `resolve_ticker` tool) because the full
~39-tool surface was causing UI rejection issues. `workbenchCompositionRoot.ts`
comments out (not deletes) the workbench-core, screener, similarity, and
follow-up-authoring registration calls specifically so this is a
straightforward uncomment once the underlying UI issue is diagnosed and
fixed.

This ticket is that restoration: diagnose what the UI was actually
rejecting about the full surface, fix it, uncomment the registration calls
in `workbenchCompositionRoot.ts`, and re-verify the epic's original
acceptance criteria (screener/workbench-core/similarity/followup tools all
reachable) against the restored surface.

Note: the wiring fixes already landed for similarity and followup-authoring
(`createSimilarityDeps`/`createFollowupAuthoringDeps`, sharing the
composition root's infra bag instead of building independent ones) remain
correct and ready to use once these groups are re-enabled — this ticket
does not need to redo that work, only re-enable it and confirm it still
holds under real use.

## Acceptance criteria

- The root cause of the "UI was rejecting it" issue that motivated the
  chart-only trim is identified and fixed (or documented as a deliberate,
  permanent scope reduction if it turns out the full surface shouldn't come
  back).
- `workbenchCompositionRoot.ts`'s commented-out registration calls
  (`registerWorkbenchTools`, `registerScreenerTools`, `registerSimilarityTools`,
  `registerFollowupAuthoringTools`) are restored, or explicitly and
  deliberately left out with a recorded reason.
- The two e2e tests skipped by the trim
  (`workbenchCompositionRoot.e2e.test.ts`'s `T-0020-3` screener flow) pass
  again.
- Full CI gate green with the restored surface.
