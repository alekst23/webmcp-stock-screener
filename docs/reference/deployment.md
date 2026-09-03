# Deployment: Live URLs & Status

Tracks the actual live deployment for T-0001-8 (mock data) and beyond.
Verify against these URLs directly rather than assuming the runbook's
example URLs are current.

## Live URLs

| Service | Platform | URL |
|---|---|---|
| Backend (FastAPI) | AWS App Runner | <https://awiz9fcu3b.us-east-1.awsapprunner.com> |
| Backend (FastAPI, retired) | Render | <https://webmcp-pattern-research-api.onrender.com> |
| Frontend (SvelteKit static) | Cloudflare Workers | <https://webmcp-stock-screener.alekst23.workers.dev/> |

The backend moved to AWS App Runner during the EPIC-0016 re-platform; the
Render URL is kept above only so older references resolve to something. The
frontend's `PUBLIC_API_BASE_URL` must point at the App Runner address.

> **Set that variable with no surrounding whitespace.** It is concatenated
> into request URLs, so a trailing space is encoded as `%20` inside the host
> name and every request fails DNS resolution, surfacing as "Failed to fetch"
> with a healthy backend. The app now trims the value
> (`src/lib/workspace/apiConfig.ts`), but the deployed `/_app/env.js` is
> generated at build time — correcting the variable requires a redeploy to
> take effect.

## T-0001-8 verification status (2026-08-31)

Checked against `T-0001-8-deployment-runbook.md`'s "Verify" section, back
when the legacy 11-tool surface was still the deployed product. **EPIC-1015
has since retired `/api/spike/ping` and every `/api/research/*` route named
below** — this table is kept as the historical record of that verification
event, not as a description of current endpoints. See "Post-cutover status"
below for what exists now; live re-verification against it is T-1015-8, not
yet run as of this doc.

| Check | AC | Result |
|---|---|---|
| Backend reachable over HTTPS | AC3 | ✅ `200`, TLS |
| Frontend reachable over HTTPS | AC3 | ✅ `200`, TLS |
| Backend serving mock data | AC1 | ✅ `GET /api/spike/ping` returns the expected mock sample payload |
| Rate limiting live | AC4 | ✅ ~56×`200` / 9×`429` over 65 rapid requests, consistent with `60/minute` |
| Frontend talking to backend (CORS) | AC2 | ✅ `CORS_ALLOWED_ORIGINS` set to the real frontend origin and backend redeployed; `Access-Control-Allow-Origin` now present on responses |
| Full example research session | AC5 | ✅ (backend path) — `POST /api/research/find-instances` against the live deployed backend, with the frontend's `Origin` header, returns real matched instances from the mock panel (not just the spike endpoint). Not yet driven through the actual frontend UI / a live WebMCP agent — that's a stronger check but wasn't required to confirm the deployed backend is functionally correct end-to-end |

T-0001-8 is functionally verified as of that date. Backend and frontend
were both live, correctly wired to each other, and serving real product
functionality over the network — on the surface that existed then.

## Post-cutover status (EPIC-1015 / T-1015-4)

`backend/api/routes/research.py` (the 5-endpoint legacy surface plus
`GET /api/research/panel`) and `backend/api/routes/spike.py` are deleted.
The surviving backend routes are:

| Route | Purpose |
|---|---|
| `GET /health` | Liveness only — succeeds whenever the process is up, independent of panel state (`backend/api/routes/health.py`). This is `render.yaml`'s `healthCheckPath`. |
| `POST /api/similarity/search`, `GET /api/similarity/runs/{run_id}`, `GET /api/similarity/runs/{run_id}/candidates/{candidate_id}/explanation` | The similarity-search tool group's backend (`backend/api/routes/similarity.py`). |
| `POST /api/backtests`, `GET /api/backtests/{backtest_id}` | The backtest tool group's backend (`backend/api/routes/backtest.py`) — the frontend tools that call it are not yet reachable from the live app; see `docs/tools.md`'s "Not yet part of the live tool surface". |

Live re-verification of these against the actual deployment is T-1015-8's
job, not this ticket's — the table above is not re-run here.

## Deploy-path deviations from the original runbook

Both discovered live during this deployment; the runbook and related docs
have been updated to match:

- **No Render persistent disk** — free tier doesn't support one, and a
  paid tier just to persist the deterministic mock panel wasn't worth it.
  The mock panel regenerates on every deploy instead. T-0001-9's real data
  will use object storage (R2/S3) rather than a Render disk. See
  `T-0001-9-real-data-pipeline.md` and `data-provider.md`.
- **Cloudflare Workers (static assets), not classic Pages** — Cloudflare's
  current Git-connected onboarding routes new projects through its
  unified Workers flow (`npx wrangler deploy`), which needs a committed
  `wrangler.jsonc` rather than a dashboard-filled "build output directory"
  field. `static/_redirects` (the classic Pages SPA-fallback mechanism)
  was removed — it conflicted with `wrangler.jsonc`'s
  `not_found_handling: "single-page-application"`, which now owns that
  role. Frontend URLs are `*.workers.dev`, not `*.pages.dev`.

## References

- `docs/plan/EPIC-0001/T-0001-8-deployment-runbook.md` — full deploy steps
- `docs/plan/EPIC-0001/T-0001-8-deploy-ops-mock.md` — the ticket this
  fulfils, its acceptance criteria and implementation notes
- `render.yaml`, `wrangler.jsonc` — the actual deploy config
