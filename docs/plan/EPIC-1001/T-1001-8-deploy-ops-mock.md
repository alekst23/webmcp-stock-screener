# T-1001-8: Deploy & ops (mock)

**Epic**: EPIC-1001 (WebMCP Pattern Research Workbench)
**Status**: Open
**Depends on**: T-1001-4
**Blocks**: T-1001-9
**Issue**: #1

## Description

To validate the architecture and rehearse the demo before any real data is
involved, the backend and frontend need to actually run on their intended
hosting, not just locally — serving the mock dataset.

## User Story

As the project owner,
I want the app fully deployed and reachable at a public URL while still
running on mock data,
so that I can validate the real hosting setup and catch deployment issues
before the paid data pipeline is in the critical path.

## Acceptance Criteria

1. The backend is deployed and publicly reachable, serving the mock
   dataset, on the hosting platform intended for the final submission.
2. The frontend is deployed and publicly reachable at a URL, and
   successfully talks to the deployed backend.
3. The deployed app is reachable over HTTPS.
4. Basic protection against excessive or abusive request volume is in
   place on the public backend.
5. A full example research session (as in T-1001-5's acceptance criteria)
   can be carried out against the deployed, mock-data-backed app, not just
   a local development environment.

## Design References

- `docs/plan.md` — hosting decisions, HTTPS requirement, rate-limiting
  decision
- `docs/design/pattern-research-workbench/spec.md` — Preconditions section
  (deployed, reachable backend is a stated precondition for the whole
  feature)

## Solution Approach

Pure infra/config, no new domain contracts. Render Web Service running
the FastAPI app (uvicorn) with the mock panel from T-1001-1 on its
persistent disk; frontend static build deployed to Cloudflare Pages or
Vercel (either is fine per `docs/plan.md` — only the backend needs
Render). CORS restricted to the deployed frontend origin. Rate limiting
via a small FastAPI middleware (e.g. `slowapi`), sufficient at this scale
per `docs/plan.md`'s risk mitigation — no custom implementation needed.

**Contracts introduced:** none.

**Config vars introduced:**
- `CORS_ALLOWED_ORIGINS` (backend) — comma-separated origins, default: the
  deployed frontend's URL once known; must not default to `*` in
  production, only during local dev.
- `PUBLIC_API_BASE_URL` (frontend, SvelteKit public env convention) — the
  deployed backend's URL, feeds `ApiClientConfig.baseUrl` (T-1001-5).

## Out of Scope

The nightly automated data-refresh job — wiring that requires the real
pipeline (T-1001-9) to exist first.
