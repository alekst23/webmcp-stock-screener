# T-0020-6: De-duplicate FIXED_PROVENANCE; align the deps-split pattern across all 3 registration modules

**Epic:** EPIC-0020
**Status:** Open

## Goal

T-0020-1 gave `registerPanelTools.ts` a two-layer split
(`createPanelShellRuntime(shared)` + a thin `createDefaultPanelShellRuntime()`
wrapper) so the composition root and the module's own default-deps
constructor share one code path. `registerWorkbenchTools.ts` and
`registerScreenerTools.ts` did not get the equivalent split — their
`createDefault*Deps()` remain single-layer, untouched, and
`workbenchCompositionRoot.ts`'s own `buildWorkbenchDeps`/`buildScreenerDeps`
duplicate their field-construction logic instead of reusing it. One
concrete symptom: `FIXED_PROVENANCE` (an identical 6-field object) is now
defined three times, byte-for-byte, across `registerWorkbenchTools.ts`,
`registerScreenerTools.ts`, and `workbenchCompositionRoot.ts`, with nothing
keeping them in sync if one changes. Found by EPIC-0020's epic review
(2026-09-02) — flagged as epic-mandated by T-0020-1's own AC2, not an
oversight, but worth cleaning up now that a real composition root exists to
own a shared constant.

## Acceptance criteria

- `FIXED_PROVENANCE` (or equivalent) is defined once and imported by all
  three sites, not duplicated.
- `registerWorkbenchTools.ts` and `registerScreenerTools.ts` get the same
  two-layer split `registerPanelTools.ts` already has, so
  `workbenchCompositionRoot.ts`'s `buildWorkbenchDeps`/`buildScreenerDeps`
  call into the module's own constructor function rather than duplicating
  its field list.
- No test currently asserting instance identity of shared fields regresses.
