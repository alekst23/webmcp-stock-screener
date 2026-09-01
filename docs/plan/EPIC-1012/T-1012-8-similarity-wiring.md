# T-1012-8: Similarity surface wiring and provenance integration

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Open
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
