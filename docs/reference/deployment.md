# Deployment: Live URLs & Status

Tracks the actual live deployment for T-1001-8 (mock data) and beyond.
Verify against these URLs directly rather than assuming the runbook's
example URLs are current.

## Live URLs

| Service | Platform | URL |
|---|---|---|
| Backend (FastAPI) | Render | <https://webmcp-pattern-research-api.onrender.com> |
| Frontend (SvelteKit static) | Cloudflare Workers | <https://webmcp-stock-screener.alekst23.workers.dev/> |

## T-1001-8 verification status (2026-08-31)

Checked against `T-1001-8-deployment-runbook.md`'s "Verify" section:

| Check | AC | Result |
|---|---|---|
| Backend reachable over HTTPS | AC3 | ✅ `200`, TLS |
| Frontend reachable over HTTPS | AC3 | ✅ `200`, TLS |
| Backend serving mock data | AC1 | ✅ `GET /api/spike/ping` returns the expected mock sample payload |
| Rate limiting live | AC4 | ✅ ~56×`200` / 9×`429` over 65 rapid requests, consistent with `60/minute` |
| Frontend talking to backend (CORS) | AC2 | ❌ **Not yet** — `CORS_ALLOWED_ORIGINS` on Render doesn't yet include the real frontend origin; a `GET` from that origin returns `200` but no `Access-Control-Allow-Origin` header, so the browser will block it |
| Full example research session | AC5 | Not yet exercised — blocked on the CORS fix above |

**Remaining step to close T-1001-8:** in the Render dashboard, set
`CORS_ALLOWED_ORIGINS` to `https://webmcp-stock-screener.alekst23.workers.dev`
and redeploy the backend (runbook step 2.5). Re-verify AC2/AC5 after.

## Deploy-path deviations from the original runbook

Both discovered live during this deployment; the runbook and related docs
have been updated to match:

- **No Render persistent disk** — free tier doesn't support one, and a
  paid tier just to persist the deterministic mock panel wasn't worth it.
  The mock panel regenerates on every deploy instead. T-1001-9's real data
  will use object storage (R2/S3) rather than a Render disk. See
  `T-1001-9-real-data-pipeline.md` and `data-provider.md`.
- **Cloudflare Workers (static assets), not classic Pages** — Cloudflare's
  current Git-connected onboarding routes new projects through its
  unified Workers flow (`npx wrangler deploy`), which needs a committed
  `wrangler.jsonc` rather than a dashboard-filled "build output directory"
  field. `static/_redirects` (the classic Pages SPA-fallback mechanism)
  was removed — it conflicted with `wrangler.jsonc`'s
  `not_found_handling: "single-page-application"`, which now owns that
  role. Frontend URLs are `*.workers.dev`, not `*.pages.dev`.

## References

- `docs/plan/EPIC-1001/T-1001-8-deployment-runbook.md` — full deploy steps
- `docs/plan/EPIC-1001/T-1001-8-deploy-ops-mock.md` — the ticket this
  fulfils, its acceptance criteria and implementation notes
- `render.yaml`, `wrangler.jsonc` — the actual deploy config
