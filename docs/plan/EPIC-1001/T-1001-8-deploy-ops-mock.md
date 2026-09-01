# T-1001-8: Deploy & ops (mock)

**Epic**: EPIC-1001 (WebMCP Pattern Research Workbench)
**Status**: Blocked — awaiting live deployment (see runbook)
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
the FastAPI app (uvicorn); the mock panel from T-1001-1 regenerates at
build time on every deploy (no persistent disk — see "Implementation
notes" below for why). Frontend static build deployed to Cloudflare Pages
or Vercel (either is fine per `docs/plan.md` — only the backend needs
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
- `RATE_LIMIT_DEFAULT` (backend) — optional, `"<count>/<period>"` per the
  `limits` package's syntax; defaults to `60/minute`. See
  `backend/.env.example`.

## Implementation notes (discovered while building this)

- **slowapi's `SlowAPIMiddleware` is broken against the FastAPI version
  this repo pins (`>=0.141.1`).** It locates the matched route by walking
  `app.routes` and reading each entry's `.endpoint`; FastAPI now lazily
  wraps `include_router()`-registered routes behind an opaque
  `_IncludedRouter` with no `.endpoint`, so that walk never finds a match
  and every request is silently exempted from rate limiting (verified
  empirically — request counts never reached the configured storage under
  `SlowAPIMiddleware`). `backend/main.py`'s `RateLimitMiddleware` checks
  the limit directly via `slowapi`/`limits`' public `Limiter.limiter.hit()`
  API instead, keyed only by client address, which needs no route
  resolution and so isn't affected. Decorator-based `@limiter.limit(...)`
  on an individual route would also have worked (it wraps the function
  directly rather than walking `app.routes`) but only protects routes that
  remember to add it — a blanket per-client check applies uniformly to
  whatever routes exist now or get added later (e.g. T-1001-5's five tool
  endpoints), matching AC4's "basic protection... on the public backend"
  intent.
- Only `GET /api/spike/ping` (T-1001-2) is registered in `backend/main.py`
  as of this ticket — T-1001-5's five networked tool endpoints hadn't
  landed yet. The runbook and rate-limit curl example both target that
  endpoint; re-check `backend/main.py` once T-1001-5 lands and prefer one
  of its endpoints instead.
- **Dropped the persistent disk originally planned for the mock panel**
  (discovered live during deployment): Render's free tier doesn't support
  disks at all, and a paid tier just to persist a deterministic,
  seconds-to-regenerate mock panel isn't worth it. The build command
  regenerates `backend/data/mock/panel.parquet` on every deploy instead —
  no functional difference, since the mock data is a fixed seeded output.
  This does **not** carry over to T-1001-9: real backfilled data is
  expensive to re-fetch (API quota) and the nightly delta job needs
  something to append to, so it needs real persistence — planned as object
  storage (R2/S3) rather than a Render disk, since object storage is far
  cheaper than Render's paid-disk tier for this data volume. See
  `T-1001-9-real-data-pipeline.md`.
- The frontend adapter is configured in `vite.config.ts` (inline in the
  `sveltekit()` plugin's `adapter` option), not a separate
  `svelte.config.js` — no such file exists in this repo; that's just how
  this project's SvelteKit/Vite version wires it, already noted in a
  pre-existing comment in `vite.config.ts` pointing at this ticket.

## Outcome (2026-08-31)

Deployed and mostly verified — see `docs/reference/deployment.md` for the
live URLs and the full verification table. AC1/AC3/AC4 pass. AC2/AC5 are
blocked on one remaining step: `CORS_ALLOWED_ORIGINS` on Render needs to
be set to the real frontend origin and redeployed. Status stays `Blocked`
until that's done and AC2/AC5 are re-verified.

## Out of Scope

The nightly automated data-refresh job — wiring that requires the real
pipeline (T-1001-9) to exist first. Also out of scope: actually carrying
out the deployment (creating the Render/Cloudflare accounts, clicking
through the dashboards) — see
`docs/plan/EPIC-1001/T-1001-8-deployment-runbook.md` for those steps,
which only a human can execute.
