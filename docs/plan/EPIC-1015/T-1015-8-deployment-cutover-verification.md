# T-1015-8: Deployment cutover verification

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Status**: Open
**Depends on**: T-1015-7
**Blocks**: —

## Description

The final wiring and integration ticket. The currently-deployed
hackathon submission runs on the surface this epic retires, across two
hosting platforms with their own configuration — a Python backend with a
health check and a rate limiter, and a static frontend build with a
public API base URL and a CORS relationship between them. A cutover that
passes local CI can still take the live app down.

This ticket verifies the whole thing end to end on the real deployment,
and is the point at which the cutover is either declared complete or
rolled back.

## User Story

As the owner of the deployed app,
I want the cutover verified against the live deployment and not just
against local tests,
so that the retirement of the old surface does not silently break what
users and judges actually open.

## Acceptance Criteria

1. The full CI gate passes on the epic branch: formatting, linting,
   typecheck, frontend tests, backend tests, and a production build,
   with no skipped or weakened tests.
2. The deployment configuration for both the backend service and the
   frontend build is consistent with the post-cutover code, including
   the health-check path, the build and start commands, and the public
   API base URL.
3. The deployed backend responds successfully to its configured health
   check.
4. The deployed frontend loads with no console errors and renders the
   new surface.
5. A real end-to-end flow — the frontend calling the deployed backend
   from a browser, exercising a representative capability of the new
   surface — succeeds against the live deployment, with the browser's
   own origin, confirming CORS is intact.
6. The WebMCP tool surface is reachable on the deployed app: the bridge
   connects, the status header reports connected, and the registered
   tool names are the new surface's.
7. No legacy route or endpoint remains reachable on the live deployment.
8. The verification evidence — what was checked, against which URLs,
   with what result — is recorded in the deployment reference doc.
9. A rollback path is stated in the ticket record: what to revert and
   what to re-deploy if the cutover has to be undone.

## Design References

- `docs/reference/deployment.md` — the live deployment runbook and the
  existing verification evidence, in the format this ticket's evidence
  should extend.
- `render.yaml`, `wrangler.jsonc` — the two platform configurations that
  must match the post-cutover code.
- `docs/plan/EPIC-1015/` — T-1015-2's parity matrix, which names the
  capabilities that must still work; the representative flow in AC5
  should be one of them.
- The prior deployment ticket's runbook under `docs/plan/EPIC-0001/` —
  the established shape of a hands-on deployment verification for this
  project, including which steps need a human.

## Technical Considerations

Parts of this verification need a real browser, a real WebMCP-capable
agent, and access to the hosting accounts. That is the established
pattern for deployment work in this project: write the runbook so a
human can execute it, and record the outcome against the acceptance
criteria afterwards. Do not mark criteria satisfied on the strength of
a local run standing in for the live one.

Two known configuration hazards carried into this ticket: the backend
health check previously pointed at a throwaway spike endpoint that the
cutover removes, and the backend applies a rate limit to its routes —
a verification script hammering the live service can trip it and
produce a false failure.

The deployment is the hackathon submission. Verify before announcing
the cutover complete, and keep the rollback path available until it is.

## Solution Approach

**Implements**: the "Deployment verification" scenarios in spec.md (happy
path, CORS, agent reachability, legacy reachability, rollback).

**Approach**: gated on T-1015-7 and the full CI gate passing on the epic
branch (AC1). Hands-on runbook ticket, not a code-writing one, following
the established pattern for deployment work in this project
(`docs/plan/EPIC-0001`'s deployment runbook ticket): a human executes
against the real Render backend and Cloudflare Workers frontend, since no
local run substitutes for the live one. Confirm `render.yaml`'s
`healthCheckPath` (`/health`, unchanged by this epic per T-1015-1's
finding that the original spike-endpoint hazard was already resolved
pre-epic) and build/start commands, and `wrangler.jsonc`'s build output
and public API base URL, match the post-cutover code. Hit the deployed
health check directly; load the deployed frontend and check the console
for errors; drive one representative flow from `capability-parity-
matrix.md`'s confirmed-live rows (e.g. results-table selection, or
whichever tool group's flag was actually flipped and shipped by
T-1015-3) end to end in a real browser against the deployed backend,
confirming CORS from the browser's own origin; connect a WebMCP-capable
agent and confirm the bridge connects, the header reports connected, and
registered tool names are the new surface's; probe the retired legacy
routes/endpoints (`/`, `/dev`, `/spike`, `/api/spike/ping`,
`/api/research/*`) and confirm none responds. All evidence (URLs hit,
results) is appended to `docs/reference/deployment.md` (AC8), extending
its existing verification-evidence format rather than replacing it. A
rollback path (revert to the pre-cutover deploy of both services, by
commit/tag) is stated in the ticket record before the runbook executes
(AC9), and the rate-limit hazard (`RATE_LIMIT_DEFAULT`) is respected by
not scripting repeated hits against the live service.

**Contracts to introduce**: none.

**Config vars introduced**: none.

**References**: `docs/reference/deployment.md`, `render.yaml`,
`wrangler.jsonc`, `docs/plan/EPIC-1015/capability-parity-matrix.md`
(the representative flow in AC5 should be one of its confirmed-live
rows), the `docs/plan/EPIC-0001` deployment runbook ticket.

## Out of Scope

New deployment targets, re-platforming, or performance tuning. Fixing
new-surface bugs discovered during verification, beyond deciding
whether they block the cutover.
