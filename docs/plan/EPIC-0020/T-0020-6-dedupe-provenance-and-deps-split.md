# T-0020-6: De-duplicate FIXED_PROVENANCE; align the deps-split pattern across all 3 registration modules

**Epic:** EPIC-0020
**Status:** Done

## Solution Approach

- Moved the shared "no market-data source configured" value into
  `workbench/domain/provenance.ts` as `NOT_CONFIGURED_PROVENANCE` (the
  common-contract module all three sites already imported `makeProvenance`
  from), replacing the three byte-for-byte `FIXED_PROVENANCE` copies in
  `registerWorkbenchTools.ts`, `registerScreenerTools.ts`, and
  `workbenchCompositionRoot.ts`.
- Gave `registerWorkbenchTools.ts` the same two-layer split
  `registerPanelTools.ts` already has: `createWorkbenchDeps(shared:
WorkbenchSharedInfra)` builds `DefaultWorkbenchDeps` directly against a
  shared infra bag, and `createDefaultWorkbenchDeps()` is now a thin
  `createWorkbenchDeps(createWorkbenchSharedInfra())` wrapper.
- Did the same for `registerScreenerTools.ts`: `createScreenerDeps(shared)`
  builds the group's own base fields (repository, revisions, history,
  registry, provenance, clock, ids, idempotency, catalog,
  instrumentDirectory) against the shared bag, deliberately leaving
  `runStore`/`panelBinding` unset (those are the composition root's own
  cross-group wiring, T-0020-2, not this group's own default).
  `createDefaultScreenerToolDeps()` is now
  `createScreenerDeps(createWorkbenchSharedInfra())`.
- `workbenchCompositionRoot.ts`'s `buildWorkbenchDeps` now delegates
  entirely to `createWorkbenchDeps`, and `buildScreenerDeps` spreads
  `createScreenerDeps(shared)` and adds only the cross-group extras
  (`runStore: shared.runs`, `panelBinding`, `evaluationPort` override) that
  only this route's composition knows about.
- Removed the dead `export type { WorkbenchSharedInfra }` re-export from
  `workbenchCompositionRoot.ts` (folded into this ticket alongside T-0020-9,
  which shares the same file) — no importer anywhere used it; the type is
  imported directly from `registerPanelTools.ts` wherever needed.
- No behavior change: `createWorkbenchSharedInfra()` builds a fresh
  instance of every field on each call, so `createDefault*Deps()` still
  returns an independent, self-consistent bag per call, matching every
  existing test's expectations (`deps.repository.list()` is still `[]`,
  etc). Verified via the full frontend suite (see epic-level report).

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
