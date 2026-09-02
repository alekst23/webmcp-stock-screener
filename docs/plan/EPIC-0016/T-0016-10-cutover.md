# T-0016-10: Cutover — frontend origin, CORS, runbook, rollback

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open
**Depends on**: T-0016-6, T-0016-8, T-0016-9
**Blocks**: T-0016-11
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

At this point AWS runs the API and the nightly job, and the memory claim is
measured — but the live frontend still calls Render. This ticket moves the
traffic and writes down how, so that the state of the deployment is a
document rather than a memory.

The frontend change is deliberately minimal: it stays on Cloudflare Workers,
and only its API base URL moves. The backend's side is the mirror image —
`CORS_ALLOWED_ORIGINS` must name the real frontend origin, never `*`, exactly
as the Render deployment established. Both directions were verified once
before, live, and `docs/reference/deployment.md` records what "verified" meant:
a table of checks against ACs, including a real research call carrying the
frontend's `Origin` header.

Render is not touched here. It stays running, warm, and able to take traffic
back, which is what makes AC7's rollback real rather than aspirational.

Done looks like: the live workbench talking to AWS end to end, a deployment
document that a stranger could act on, and a rollback that has been shown to
work rather than described.

## User Story

As a user of the deployed workbench,
I want the frontend talking to the AWS backend,
so that research runs against real data with real memory — and so that if
something is wrong, the previous deployment is one documented step away.

## Acceptance Criteria

1. The deployed frontend calls the AWS backend origin, and no request from
   the live application reaches Render.
2. The backend allows the deployed frontend's exact origin and no wildcard,
   and a browser request from that origin succeeds with the appropriate
   cross-origin response headers present.
3. A request from an origin not on the allowlist is refused.
4. A complete research session — driven through the frontend UI, not only by
   direct API calls — returns real matched instances from the migrated panel.
5. The panel's as-of date shown in the UI matches the migrated panel's latest
   session, and its provenance shows the real object store rather than the
   mock fallback.
6. Rate limiting is confirmed live on the new origin, at the configured
   budget.
7. Rollback to Render is documented as concrete steps, and is demonstrated —
   not merely described — at least once before this ticket closes.
8. A deployment document records the live URLs, a verification table of
   checks against acceptance criteria with their results and the date, and
   any deviation discovered during the real deploy, mirroring the structure
   of the existing Render deployment record.
9. The document states what remains on Render and what turning it off will
   require, so T-0016-11 has a checklist rather than an investigation.

## Design References

- `docs/reference/deployment.md` — the structure AC8 mirrors (Live URLs /
  verification status table / deploy-path deviations / references), and the
  record of what was verified on Render on 2026-08-31
- `backend/main.py` — `_allowed_origins`, which reads a comma-separated
  `CORS_ALLOWED_ORIGINS` and defaults to `http://localhost:5173`; the
  rate-limit middleware AC6 exercises
- `.env.example` — `PUBLIC_API_BASE_URL`, the frontend's backend origin
- `wrangler.jsonc` — the frontend deployment this ticket redeploys with a new
  API origin and nothing else
- `render.yaml` — what stays running through cutover, and its `sync: false`
  variables, which are the manual state AC9 must enumerate

## Technical Considerations

CORS is genuinely configuration on both sides — the backend already reads the
allowlist from the environment and the frontend already reads its base URL
from one. What makes this a ticket is the ordering: the frontend redeploy and
the backend allowlist must both be in place before either is useful, and
getting them out of order produces a broken live site rather than a failed
deploy. Set the backend allowlist first; it is harmless while nobody is
calling from that origin.

AC4 is deliberately stronger than the Render verification achieved. That
record notes the full session was confirmed on the backend path but "not yet
driven through the actual frontend UI / a live WebMCP agent — that's a
stronger check". Cutover is the right moment to close that gap, because it is
the last point at which Render is still available if the answer is bad.

AC7's "demonstrated, not described" is the difference between a rollback plan
and a rollback. Render's free web plan sleeps when idle, so an untested
rollback path may involve a cold start nobody has timed.

## Out of Scope

Turning Render off (T-0016-11). Any frontend change beyond the API origin.
DNS or custom domains, unless the chosen HTTPS front requires one.
