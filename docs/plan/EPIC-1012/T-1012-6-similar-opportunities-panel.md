# T-1012-6: `similar_opportunities` panel kind

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Open
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

- `docs/reference/tool-spec.md` — `add_panel`'s `similar_opportunities` panel
  kind, and the market-data provenance rule
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
