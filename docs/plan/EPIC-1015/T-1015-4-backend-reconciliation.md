# T-1015-4: Backend reconciliation

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Status**: Open
**Depends on**: T-1015-2
**Blocks**: T-1015-7

## Description

The Python backend is a FastAPI + pandas research engine built for the
legacy surface: routes that find, sample, measure and split instances,
plus a throwaway spike endpoint. Some of it is product surface tied to a
retiring model; some of it — the pandas engine, the expression evaluator,
the domain models — is computational infrastructure the new screener may
well run on. This ticket decides which is which and deletes the dead
half.

It also fixes a concrete deployment hazard: the platform health check
points at the spike endpoint, which is otherwise a retirement candidate.

## User Story

As the engineer maintaining the backend after cutover,
I want only the modules that serve the shipping surface to remain,
so that the backend's routes and its layered architecture describe one
product rather than the sediment of two.

## Acceptance Criteria

1. Every backend module is classified as serving the new surface or dead,
   consistent with T-1015-1's inventory and T-1015-2's parity matrix.
2. Backend modules that serve no surface are deleted, along with their
   tests and their route registrations.
3. Modules that survive keep their tests, and the backend test suite
   passes.
4. No HTTP route remains registered that no client calls.
5. The deployment health check targets an endpoint that exists after
   this ticket, and that endpoint reports genuine service health rather
   than echoing throwaway spike data.
6. CORS configuration still admits the deployed frontend origin and the
   local dev origin.
7. The layered architecture holds: the domain layer imports nothing from
   infrastructure, and no layer gained an inward-pointing dependency
   during the cleanup.
8. No commented-out code, unused imports, or unreachable branches remain
   in the touched modules.

## Design References

- `docs/plan/EPIC-1015/` — T-1015-1's inventory and T-1015-2's parity
  matrix.
- `docs/design/pattern-research-workbench/technical.md` — the query
  engine contract, the stats models, and the price-bar panel schema;
  these say what the pandas engine actually computes and therefore how
  reusable it is.
- `docs/reference/deployment.md` — records what was verified live and
  against which endpoints; the health-check change must be reflected
  there (in T-1015-7) and re-verified (in T-1015-8).
- `docs/reference/data-provider.md` — the data pipeline behind the panel
  the engine reads; relevant to whether the engine is worth keeping.

## Technical Considerations

The likely split, from reading the backend during epic authoring:

- The engine protocol in the domain contracts layer is written in terms
  of studies, setups, instances and instance sets. If the new surface
  keeps the pandas engine, this contract needs re-expressing in the new
  surface's vocabulary rather than being deleted wholesale — the
  implementation underneath it is the valuable part.
- The expression evaluator is a self-contained, typed formula engine with
  no legacy-model coupling. It maps naturally onto the new surface's
  computed-field and custom-study needs, which the target spec
  deliberately specifies as a typed expression model rather than
  arbitrary code.
- The spike route and schema, and their functional test, are T-0001-2
  scaffolding. Retire them — but repoint the deployment health check
  first, in the same change, or the deploy fails on the next push.
- Mock-panel generation and the data-fetch scripts are deployment
  infrastructure, not product surface. The mock panel regenerates on
  every deploy by design, so removing it would break deploys.

Backend style: 4-space indent, Black at line length 100, type hints,
exception chaining at infra boundaries.

## Out of Scope

Frontend changes (T-1015-3, T-1015-5, T-1015-6). Building new backend
endpoints for the new surface — those belong to the sibling epics that
own them. Re-platforming or performance work.
