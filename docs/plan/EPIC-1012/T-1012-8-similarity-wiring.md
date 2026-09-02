# T-1012-8: Similarity surface wiring and provenance integration

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Done
**Depends on**: T-1012-4, T-1012-5, T-1012-7
**Blocks**: —

## Description

The three tools, the engine, the API, and the panel all exist by this
point but have only been proven in isolation. This ticket connects them
into one working capability and proves the whole path end to end: capture
a setup, find similar ones, see them in a panel, explain any match, and
compare them visually — all through tool calls, with provenance intact at
every hop.

This is the epic's integration ticket. It is also where the epic's
non-negotiable constraint is verified: the existing 11-tool surface still
works and `main` is still deployable.

## User Story

As a researcher using the new workbench,
I want the similarity tools to work together as one capability rather than
as three separate features,
so that a single line of investigation runs from a captured chart to a set
of compared, explained matches without leaving the session.

## Acceptance Criteria

1. All three similarity tools — `find_similar_setups`,
   `explain_similarity`, and `compare_setups` — are registered on the new
   tool surface and are discoverable and callable by an agent in one
   session.
2. An end-to-end run succeeds through tool calls only: a captured setup is
   searched, its candidates appear in a `similar_opportunities` panel, one
   candidate is explained, and a subset is compared in each of the three
   comparison forms.
3. Provenance survives every hop: the `as_of`, source, live/delayed status,
   timezone, currency, adjusted/unadjusted price basis, and
   calculation-engine version reported by the panel and the comparison view
   match what the backend reported for that run.
4. The score a candidate is ranked by in the panel, the score
   `find_similar_setups` returned, and the score `explain_similarity`
   reconciles its contributions to are the same value for that candidate.
5. Normalization settings flow unchanged from the captured setup through
   the search into the comparison views, and the settings displayed match
   the settings applied.
6. Undoing a `find_similar_setups` call returns the workspace to its prior
   state, including removing any panel that call bound.
7. Backend unavailability during a search surfaces as an actionable tool
   error and leaves the workspace unchanged — no partially applied change,
   no panel bound to a run that does not exist.
8. The existing 11-tool pattern-research surface registers and functions
   exactly as before, its UI is unchanged, its tests pass, and the app
   builds and deploys.
9. The full test suite passes and the project's CI gate is green.

## Design References

- `docs/reference/tool-spec.md` — the Similarity area this epic completes,
  and the common-contract and provenance rules verified here
- `docs/design/similarity-search/spec.md` — the behavioral scenarios this
  ticket verifies end to end
- `src/lib/webmcp/register.ts`, `src/lib/webmcp/session.ts` — the existing
  registration and session lifecycle the new surface parallels
- `src/lib/webmcp/integration.test.ts` — the existing end-to-end
  tool-sequence test style to follow for AC2

## Technical Considerations

- AC8 is the program-level constraint from the standing decisions: the new
  surface is built alongside the old one and EPIC-1015 retires the old one
  at the very end. Any change required to an existing file to make wiring
  work is a signal to add a new seam, not to edit the old surface.
- AC4 spans three components and is the criterion most likely to be
  satisfied by coincidence in a fixture. Verify it against a run with a
  non-uniform weight set, where an incorrect score would differ visibly.
- Cross-epic contracts land here first: EPIC-1006's envelope, EPIC-1007's
  panel registry, and EPIC-1011's captured setup. If any is still in flux
  when this ticket runs, record the mismatch as a finding for the owning
  epic rather than forking a local copy of the contract.

## Out of Scope

- Retiring the existing 11-tool surface (EPIC-1015).
- `refine_similarity_search` (EPIC-1014).
- Reference and fundamental market-data sourcing (separate workstream,
  consumed through EPIC-1008's ports).

## Solution Approach

**Finding: the new surface is staged, not live, program-wide.**
`chart/tools/registerChartTools.ts` (`CHART_TOOLS_ENABLED = false`) and
`workbench/tools/registerWorkbenchTools.ts` (`WORKBENCH_TOOLS_ENABLED =
false`) are both no-ops until flipped, and neither is called from
`src/routes/workbench/+page.svelte` (which registers only the 14
flag-free panel-container tools). Even EPIC-1011's chart tools, already
merged, are not live in the running app. This is a deliberate,
program-wide staging decision predating this epic. AC1/AC2 ("registered
on the new tool surface", "an end-to-end run succeeds through tool calls
only") are satisfied the same way every sibling composition root
satisfies them: a flagged-off `registerSimilarityTools.ts`
(`SIMILARITY_TOOLS_ENABLED = false`), proven end to end by a **test-level**
integration (`tools/similarityIntegration.test.ts`) that drives the three
real tool builders against a stubbed backend -- not by editing
`+page.svelte` or flipping any other epic's flag, both out of scope here.

**Finding: the panel-kind-registry conflict (consolidated).**
T-1012-4, T-1012-6, and T-1012-7 each independently hit and flagged the
same gap: `defaultPanelKinds.ts` (EPIC-1007) unconditionally registers a
_placeholder_ `similar_opportunities` kind into the live app's one
`PanelRegistry`, and `PanelRegistry.register()` throws
`PanelKindConflictError` on a duplicate with no unregister/replace path.
This ticket's own composition root (`createDefaultSimilarityDeps`) and its
integration test both build a **fresh** registry carrying only the real
`similarOpportunitiesPanelKindDefinition`, never combined with
`registerDefaultPanelKinds()` in the same instance -- consistent with
every prior ticket, and not fixed here per this ticket's own Technical
Considerations ("record the mismatch... rather than forking a local
copy"). **Consolidated recommendation for EPIC-1007 (or whoever performs
the whole-program staged-rollout flip):** `registerDefaultPanelKinds`
needs a skip-if-already-registered mode, or `PanelRegistry` needs a
`replace()`/`unregister()` method, before any epic's real panel kind can
coexist with the placeholder set in one live registry. Until then, the
five kinds still without a real owner (`filter_builder`, `study_library`,
`results_table`, `watchlist`, `alerts`, `symbol_details`) plus `chart`
and `similar_opportunities` cannot all be registered together in the
live app's actual runtime registry.

**Files:**

- `tools/registerSimilarityTools.ts` — the composition root: flag,
  `createDefaultSimilarityDeps()`, `registerSimilarityTools(deps?)`,
  mirroring `registerChartTools.ts`'s shape. Combines
  `FindSimilarSetupsDeps` (`PanelUseCaseDeps & { api }`),
  `ExplainSimilarityDeps` (`{ api }`), and `PanelUseCaseDeps` for
  `compare_setups` from one shared `SimilarityToolsDeps` object, since all
  three share the same panel-registry/workspace/api instances in a real
  session.
- `tools/similarityIntegration.test.ts` — the end-to-end proof (AC2-AC7),
  in `webmcp/integration.test.ts`'s style: a stubbed `fetch` implementing
  T-1012-3's three real routes (verified against `httpSimilarityApi.ts`'s
  actual wire shapes, not assumed), driving the three real tools in
  sequence against one shared workspace. A non-uniform weight set
  (price_shape 0.7, volume 0.3) is used throughout so AC4's score-identity
  check cannot pass by coincidence on a uniform fixture, per this ticket's
  own Technical Considerations.

**AC4 interpretation.** "The score a candidate is ranked by in the panel"
is read as the score carried by the `SimilarityRun` the panel's
`config.runId` points to (there is no Svelte render harness in this
project — see T-1012-6's Solution Approach — so no test here renders a
DOM). The integration test asserts the candidate score returned by
`find_similar_setups`, reconciled by `explain_similarity`, and the score
recorded on the created panel's bound run are the same number, sourced
from one stubbed backend response, never re-derived.

**AC8/AC9 verification.** No T-1012-1..7 file is modified by this ticket
except where noted below. Full `npm test` and `npm run typecheck` run
after this ticket's changes; `cd backend && uv run pytest` run once to
confirm the (untouched) backend suite is unaffected; `npm run build` run
once to confirm the app still builds.
