# T-1012-3: Similarity search and explanation API

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Open
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

- `.dev/design/tool-spec.md` — market-data provenance requirements that
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
