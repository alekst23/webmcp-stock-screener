# T-0016-2: Health endpoint independent of the spike stack

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open
**Depends on**: —
**Blocks**: T-0016-6
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

`render.yaml` health-checks `/api/spike/ping`. That route is part of the
throwaway spike stack EPIC-1015 plans to retire, and the project's blocker
table already records the consequence: delete the spike stack and the backend
deploy fails its health check. Carrying that blocker onto AWS would be
choosing to hit it later on a platform where an unhealthy target is also
deregistered from the load balancer.

There is no alternative today. Verified: the only routers are
`/api/spike` and `/api/research`, and the only plausible substitute,
`GET /api/research/panel`, answers 503 when no engine loaded — which is
exactly the degraded-but-serving state that must not deregister a task.
`/api/spike/ping` is worse still: it reads the mock Parquet file off disk and
constructs a `PriceBar` on every probe, so a health check performs file I/O
and pandas work at the load balancer's interval.

Done looks like: a cheap endpoint outside the spike prefix that answers only
"this process is up and serving HTTP", and a spike stack that can be deleted
without touching infrastructure.

## User Story

As the load balancer,
I want a liveness endpoint that does not depend on demo code or on data
being loaded,
so that a task is recycled when the process is genuinely broken and left
alone when it is merely serving a degraded panel.

## Acceptance Criteria

1. A health endpoint exists outside the `/api/spike` prefix and returns a
   success status whenever the application process is running and serving
   HTTP.
2. It returns success when no panel is loaded at all, and when the loaded
   panel is the mock fallback rather than the real one.
3. It performs no file I/O, no object-storage call, and no panel computation.
4. It is exempt from the per-address rate limit, so a frequent probe cannot
   exhaust the budget or be throttled into a false negative.
5. Deleting every route under `/api/spike` leaves the endpoint working.
6. Panel provenance and staleness remain available to callers, unchanged,
   through the existing research surface.

## Solution Approach

A new `GET /health` route, defined in `backend/api/routes/health.py` and
registered directly on the app in `backend/main.py`
(`app.include_router(health_router)`), outside the `/api/spike` prefix per
AC1. The handler takes no parameters -- no `Request`, no
`Depends(get_engine)`, no read of `app.state` -- so it cannot touch the
panel, the object store, or any file on disk. That satisfies AC2 (a process
with no panel or with the mock fallback answers exactly like one with a real
panel: the handler never looks) and AC3 (there is no I/O path to skip,
because none exists).

AC4's rate-limit exemption is implemented in the same middleware that
already applies the blanket per-address budget (`main.py`'s
`RateLimitMiddleware.dispatch`), not as a second middleware or a slowapi
per-route decorator -- the latter is what that middleware's own docstring
already documents as silently inert against `include_router()`-registered
routes on this FastAPI version. `RateLimitMiddleware` gains an
`exempt_paths: frozenset[str]` constructor parameter; `dispatch` checks
`request.url.path` against it before calling `limiter.limiter.hit(...)`,
calling `call_next` directly on a match. `main.py` passes
`frozenset({HEALTH_PATH})`, where `HEALTH_PATH` is a constant exported from
`api/routes/health.py` -- the same string the route itself is registered
under -- so the exemption cannot drift from the route it exempts.

AC5 ("deleting every `/api/spike` route leaves the endpoint working") is
structural, not incidental: `api/routes/health.py` imports nothing from
`api.routes.spike` (no shared `PANEL_PATH`, no shared response schema), and
`main.py` registers `health_router` as its own `app.include_router()` call,
never derived from or conditioned on `spike_router`'s presence. Deleting
`backend/api/routes/spike.py` and its one registration line in `main.py`
removes nothing `health.py` or the rate-limit exemption references. A test
builds a bare `FastAPI()` app with only `health_router` registered -- no
`spike_router`, no `research_router` -- and asserts `GET /health` still
succeeds; that is the only way to demonstrate "structurally guaranteed"
rather than "coincidentally true while spike.py still exists."

`render.yaml`'s `healthCheckPath` is repointed from `/api/spike/ping` to
`/health` in the same change (see Technical Considerations above).

## Design References

- `backend/api/routes/spike.py` — the current health target and what it
  actually does per request
- `backend/api/routes/research.py` — `GET /api/research/panel`, which stays
  the answer for "is the real panel loaded and how stale is it"
- `backend/main.py` — router registration, the rate-limit middleware, and the
  lifespan hook that loads the engine
- `backend/application/load_panel.py` — the deliberate mock fallback that AC2
  exists to tolerate
- `docs/plan/project.md` — the recorded blocker this ticket closes

## Technical Considerations

The recorded position (epic Open Question 6) is that this is **liveness
only**, not readiness. T-0013-5 chose to disclose panel degradation to the
user rather than fail on it; a probe that fails on the mock fallback would
make that deliberate degradation unroutable, turning a visible-but-working
deploy into an outage. If a readiness signal is wanted later it should be a
separate endpoint with separate semantics, not overloaded onto this one.

`render.yaml`'s `healthCheckPath` should be repointed in the same change even
though Render is being retired — the two services coexist through T-0016-10's
cutover, and leaving the old path there means the blocker is still live for
whichever of the two is turned off last.

## Out of Scope

Retiring the spike stack itself (EPIC-1015). Any readiness or dependency-check
semantics. Metrics or observability endpoints.
