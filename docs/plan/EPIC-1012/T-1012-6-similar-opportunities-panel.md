# T-1012-6: `similar_opportunities` panel kind

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Done
**Depends on**: T-1012-1
**Blocks**: T-1012-7

## Description

A similarity run the human cannot see is not a shared research session.
This ticket contributes the `similar_opportunities` panel kind to the
panel-kind registry EPIC-1007 defines: a ranked, selectable list of
candidates showing each one's score and the features that drove it,
sitting in the panel container like any other panel.

It depends only on the similarity contract, so it can be built and tested
against fixture runs in parallel with the engine and API work.

## User Story

As a researcher whose agent just ran a similarity search,
I want the candidates visible in a panel with their scores and driving
features,
so that I can see and steer what the agent found instead of reading a tool
response I never see.

## Acceptance Criteria

1. A `similar_opportunities` panel renders a similarity run's candidates
   ranked by score, each showing its instrument, its historical window,
   its overall score, and the feature families that contributed most to
   that score.
2. No candidate is ever presented as a score with no accompanying feature
   context.
3. The panel states the run's normalization settings and market-data
   provenance — `as_of`, source, live/delayed status, timezone, currency,
   adjusted/unadjusted price basis, and calculation-engine version —
   visibly, not only in the underlying data.
4. Selecting a candidate makes that selection readable as workspace state,
   so an agent reading the workspace can act on "this one".
5. The panel is registered through the panel-kind registry and is added,
   retitled, laid out, linked, and removed by the ordinary panel operations
   with no special-casing for this kind.
6. A run with zero candidates renders an explicit empty state carrying the
   run's warning text, distinguishable from a panel that has not been given
   a run yet.
7. A run whose reference setup or candidate windows have unavailable
   feature families shows those families as unavailable rather than as
   zero-valued.
8. The panel is a new panel kind on the new surface; the existing
   workspace UI, its panels, and its store are unchanged.

## Design References

- `docs/reference/tool-spec.md` — `create_panel`'s `similar_opportunities`
  panel kind, and the market-data provenance rule
- `docs/plan/EPIC-1012/T-1012-1-similarity-contract.md` — the candidate,
  run, normalization, and provenance shapes this renders
- `src/lib/workspace/GridPanel.svelte` — the existing panel component
  structure, including panel-scoped actions attached to the panel itself
  rather than to a disconnected control elsewhere on the page
- `docs/design/pattern-research-workbench/spec.md` — the established
  convention that panel actions belong to their panel (feature #7)

## Technical Considerations

- EPIC-1007 owns the panel container and the panel-kind registry. Register
  with it; do not build a parallel container, and do not modify the
  registry's contract to accommodate this kind — if it does not fit, that
  is a finding to report to EPIC-1007, not a local workaround.
- This project has no Svelte component-render test harness; existing
  practice is to unit-test the pure logic (ranking presentation, empty and
  unavailable-family states) and verify rendered behavior in the browser
  at ticket close. Follow that convention rather than introducing a harness
  as a side effect of this ticket.
- Build against fixture runs conforming to T-1012-1's contract so this
  ticket does not wait on the engine or API.
- New files only.

## Out of Scope

- The comparison views — overlays, synchronized charts, small multiples
  (T-1012-7).
- Running a search or fetching a run from the backend (T-1012-4, T-1012-8).
- The panel container, layout, and linking machinery (EPIC-1007).

## Solution Approach

New files under `src/lib/workbench/similarity/panel/`:

- `domain/presentation.ts` — pure functions: `rankCandidates` (sorts a
  run's candidates by score, defensively — does not trust upstream
  ordering), `topContributingFamilies(candidate, weights, limit)` (ranks a
  candidate's *available* families by `weight * perFamilySimilarity`,
  excluding `unavailableFamilies` — an estimate for display only; the
  reconciling breakdown is `explain_similarity`'s job, T-1012-5, not this
  panel's), `formatProvenance`, `formatNormalization`, `emptyRunMessage`.
- `domain/panelKind.ts` — the real `PanelKindDefinition` for
  `similar_opportunities`: `defaultConfig()` is `{ runId: null }` only.
  Candidate *selection* is NOT a config field — it reuses the existing
  generic `state.selections[panelId]` / `panels.set_panel_selection`
  mechanism (`src/lib/panels/application/setPanelSelection.ts`), which
  already satisfies AC4 ("selection readable as workspace state") for any
  panel kind with no special-casing needed here.
  `bindingTypes: []`, `defaultRenderer: null` — deliberately, unlike the
  EPIC-1007 placeholder's `chart_grid`/source-bound shape: this panel is
  bound to a *similarity run* via `config.runId`, not to a
  `screener_results`/`watchlist` source through the source/renderer
  registry, so it does not participate in that contract at all.
- `components/SimilarOpportunitiesPanel.svelte` — the real component.

### Two integration gaps found while building this (neither is this
### ticket's to fix — reporting per the Technical Considerations above)

1. **Panel-kind registration collision.** EPIC-1007's
   `src/lib/panels/registry/defaultPanelKinds.ts` already pre-registers a
   *placeholder* `similar_opportunities` kind, and the live composition
   root (`src/lib/panels/shell/registerPanelTools.ts`) calls
   `registerDefaultPanelKinds` unconditionally against its one shared
   `PanelRegistry`. `PanelRegistry.register()` throws on a duplicate kind
   and the registry has no unregister/replace method, so registering this
   ticket's real definition into that same live registry, as things stand,
   collides. Confirmed this is not this ticket's problem alone: EPIC-1011
   (chart, already merged) has not registered a real `chart` kind either —
   nothing calls `panelKindRegistry`/`createPanelRegistry().register()` for
   `chart` anywhere in `src/lib/workbench/chart/`. This ticket's own tests
   register the real definition into a **fresh** `createPanelRegistry()`
   instance (matching `defaultPanelKinds.test.ts`'s own idiom), which fully
   exercises AC5 without touching the live registry. **T-1012-8 (epic
   wiring) needs to resolve this** — either reorder
   `registerPanelTools.ts` to register real kinds before
   `registerDefaultPanelKinds` (a real edit to an EPIC-1007 file), or ask
   EPIC-1007 to add a replace/overwrite capability to `PanelRegistry`.
2. **Real panel bodies receive no props today.** `PanelFrame.svelte`'s
   `<Body />` branch (the one a real, non-placeholder `component()`
   resolves to) is invoked with zero props or context — no panel id, no
   config, no use-case deps. No epic has shipped a real `component()`
   before this ticket, so this has not surfaced yet.
   `SimilarOpportunitiesPanel.svelte` is written with every prop optional
   (`run`, `selectedCandidateId`, `onSelectCandidate`), so it mounts safely
   today (rendering its "no run bound" empty state under the live
   container, since nothing is passed in yet) and becomes live the moment
   `resolvePanelBody`/`PanelFrame.svelte` is extended to pass
   `{ config, onAction }`-shaped props to real components — **flagging for
   T-1012-8 or EPIC-1007**, whichever owns that follow-up.

### Testing

No new test harness introduced: `src/lib/workbench/chart/components/
ChartPanel.test.ts` already establishes real Svelte-component render
testing in this codebase via `mount`/`flushSync`/`unmount` from `'svelte'`
under the existing jsdom vitest environment (not a "harness" library, just
Svelte's own primitives) — this ticket's component test follows that exact
precedent, in addition to the presentation-logic unit tests the ticket
anticipates. All new tests are mutation-checked: the fix/behavior each one
covers was reverted, the test observed to fail, then restored.
