# T-1012-3: Similarity search and explanation API

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Done
**Depends on**: T-1012-2
**Blocks**: T-1012-4, T-1012-5

## Description

The similarity engine runs in the Python backend; the WebMCP tools run in
the browser. This ticket is the boundary between them — the HTTP surface
that accepts a search, returns a pinned run, pages its candidates, and
serves an explanation for any one of them.

It is deliberately a thin layer: request validation, error mapping to the
project's exception hierarchy, and provenance passthrough. All analytical
behavior stays in the engine.

## User Story

As the browser-side similarity tools,
I want a stable HTTP contract for running a similarity search, reading its
results, and explaining any match,
so that the tool layer carries no analytical logic of its own.

## Acceptance Criteria

1. A search can be requested with a reference setup, a search scope, an
   optional weight set, an optional result limit, and an optional minimum
   score; it returns a pinned run identified by a stable run ID.
2. The response includes the ranked candidates, the weight set actually
   applied, the normalization settings actually applied, the search scope
   applied, any warnings, and the full market-data provenance.
3. A completed run's candidates can be read back by run ID in bounded pages
   without re-running the search — the same run ID always yields the same
   candidates in the same order.
4. An explanation can be requested for one candidate of one run and returns
   the per-family weight, measured similarity, and signed contribution,
   plus the overall score they reconcile to.
5. Requesting a run ID that does not exist, or a candidate ID that is not
   part of the named run, returns a distinguishable client error naming
   what was not found — not a server error and not an empty success.
6. An invalid weight set (unknown family, negative weight) is rejected with
   a validation error naming the offending entry.
7. A request for a reference setup the backend has no history for returns a
   client error stating what is missing, rather than an empty result that
   reads as "no similar setups exist".
8. Errors raised at the engine boundary are chained to their cause and
   surfaced through the project's existing exception hierarchy and HTTP
   error mapping.
9. Every successful response states its provenance; no response carrying
   market-derived numbers omits it.
10. The route layer contains no scoring, ranking, or feature computation —
    it validates, delegates, and maps.

## Design References

- `docs/reference/tool-spec.md` — market-data provenance requirements that
  every response must satisfy
- `backend/api/routes/research.py` and `backend/api/schemas/research.py` —
  the existing route and schema layering, error mapping, and naming style
- `backend/core/exceptions.py`, `backend/domain/errors.py` — the exception
  hierarchy to raise through, and the chaining convention
- `backend/tests/functional/test_research_routes.py` — the functional route
  test style, including how the engine is substituted
- `backend/tests/mocks/mock_pattern_research_engine.py` — the existing
  engine-fake pattern for route tests

## Technical Considerations

- Follow the project's layer rule strictly: the API layer may import from
  application, domain, infra, and core; the domain layer imports from none
  of them.
- A fake engine used in route tests must implement real behavior for the
  scenarios under test, not be keyed by name — a name-keyed fake would let
  a route return a plausible run it never actually requested.
- Run pinning: AC3's guarantee is what makes the tool layer's "don't
  silently re-run" promise possible, so the storage lifetime of a run must
  be explicit (documented eviction, not accidental).
- New route module and new schema module. Do not modify the existing
  research routes or schemas.

## Out of Scope

- WebMCP tool registration (T-1012-4, T-1012-5).
- Comparison view data (T-1012-7).
- Authentication or rate limiting.

## Solution Approach

**Files:**
- `backend/api/schemas/similarity.py` — `SimilaritySearchRequest`,
  `SimilarityRunPage` (the paged read-back response).
- `backend/api/routes/similarity.py` — three endpoints, all thin
  validate/delegate/map per AC10.
- `main.py` — additive wiring only (see below).
- `backend/tests/functional/test_similarity_routes.py`.

**Reference resolution (AC1):** T-1012-2's `search()` takes an
`instrument_id` + `WindowRef` directly, not a captured-setup ID — the
backend has no access to the browser's workspace/captured-setup extension.
`SimilaritySearchRequest` therefore carries `instrument_id`, `window`
(`start`/`end`/`timeframe`), and an optional `reference_setup_id` (echoed
onto the run for T-1012-4's tool to fill in from the real captured setup
ID it resolved client-side, per T-1012-2's Solution Approach note). This
mirrors `research.py`'s existing pattern of accepting domain data by value
rather than by server-side ID lookup.

**Endpoints:**
- `POST /api/similarity/search` → `SimilarityRun` (AC1, AC2). Builds a
  `FeatureWeightSet` from the request's optional partial weight dict via
  `FeatureWeightSet.from_partial`, catching its `ValueError` and mapping to
  422 naming the offending entry (AC6) — the same shape
  `research.py`'s `_expression_error` uses for `ExpressionError`, adapted
  since weight validation raises a plain `ValueError` rather than a
  `DomainError` subclass (T-1012-1's `FeatureWeightSet.from_partial` was
  already committed with that signature; not worth re-opening to add a
  typed exception for one call site).
- `GET /api/similarity/runs/{run_id}?offset&limit` → `SimilarityRunPage`
  (AC3). The engine's `get_run()` returns the full pinned run
  un-paginated (T-1012-2 didn't add paging to the Protocol); this route
  slices `run.candidates[offset:offset+limit]` itself and reports
  `total_candidates`/`next_offset`, so paging is purely a read-side
  concern and the same run ID always yields the same slice.
- `GET /api/similarity/runs/{run_id}/candidates/{candidate_id}/explanation`
  → `SimilarityExplanation` (AC4) — read-only, so GET (not POST), matching
  this ticket's own AC9-style provenance-passthrough framing for a
  read endpoint.

**Error mapping (AC5, AC7, AC8):**
`SimilarityRunNotFoundError`/`SimilarityCandidateNotFoundError` → 404
(names the missing ID, distinguishable from a 500 or an empty 200).
`SimilarityReferenceUnavailableError` → 422 (client error stating what
history is missing, so it never reads as "no similar setups exist" —
AC7). All three are `DomainError` subclasses already chained (`raise ...
from e`) at T-1012-2's engine boundary; this route layer only catches and
maps, adding no new chaining of its own since it does no further
wrapping.

**Protocol/implementation gap fixed in passing:** T-1012-2's
`domain/contracts/similarity_engine.py` `SimilarityEngine.search()`
Protocol was missing the `reference_setup_id` keyword that
`PandasSimilarityEngine.search()` actually accepts (confirmed by grep —
present in the infra implementation, absent from the Protocol). Added the
one parameter to the Protocol to match, so this route (which types its
FastAPI dependency as the concrete `PandasSimilarityEngine`, exactly as
`research.py`'s own `get_engine` does — not the Protocol, consistent with
existing convention) and any future Protocol-typed caller see the same
signature. This is this epic's own file, not another epic's contract.

**Wiring (`main.py`, additive only — no existing endpoint's behavior
changes):** `_load_engine()` already loads a `PanelFrame` + `PanelStatus`
via `load_panel()` and discards the `PanelFrame` after constructing
`PandasPatternResearchEngine`. Extended its return to also construct and
return a `PandasSimilarityEngine(loaded.panel, loaded.status)`, stored on
`app.state.similarity_engine` alongside the existing `app.state.engine`,
and `app.include_router(similarity_router)` added next to the other three
routers. A new `get_similarity_engine` dependency mirrors `research.py`'s
`get_engine` exactly, including its 503 fallback message when no panel is
loaded.

**Testing:** functional, against the real mock panel through
`TestClient`, mirroring `test_research_routes.py`'s style exactly (no
route-level fake engine — AC10 already forces the route to carry no
analytical logic, so exercising it against the real engine is more
evidence than a name-keyed fake would be, and this project's guidance
against name-keyed fakes for scenarios under test is easier to honor by
just using the real thing here). All new tests mutation-checked.
