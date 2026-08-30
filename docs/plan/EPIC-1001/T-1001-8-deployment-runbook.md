# T-1001-8: Deployment Runbook

**Audience**: a human with a credit card and a browser -- this is the part
of T-1001-8 an autonomous coding agent cannot do (creating real hosting
accounts, clicking through real dashboards). See
[`docs/plan/EPIC-1001/T-1001-8-deploy-ops-mock.md`](T-1001-8-deploy-ops-mock.md)
for the ticket this fulfils and why its status is `Blocked — awaiting live
deployment`, not `Done`, until these steps are actually carried out.

Everything below assumes the repo is on the branch that carries this
epic's mock-data-backed backend/frontend (`epic/EPIC-1001-pattern-research-workbench`
or later, once T-1001-8's work merges into it).

## What you're deploying

- **Backend**: FastAPI (`backend/`), serving the T-1001-1 synthetic mock
  panel, on **Render**, via the blueprint at [`render.yaml`](../../../render.yaml).
- **Frontend**: SvelteKit static build (`src/`), on **Cloudflare Pages**,
  via `@sveltejs/adapter-static` (configured in [`vite.config.ts`](../../../vite.config.ts))
  + the SPA-fallback rule in [`static/_redirects`](../../../static/_redirects).

Both come up on the platforms' own HTTPS domains by default (AC3) --
`*.onrender.com` and `*.pages.dev` respectively -- no separate TLS setup
needed for the mock-data stage.

---

## 1. Backend: deploy to Render

1. Create a Render account (or sign in) at <https://render.com>.
2. **New +** → **Blueprint**. Connect this GitHub repo when prompted (Render
   will ask for repo access via the GitHub App if this is the first time).
3. Point the blueprint at the branch you're deploying and at `render.yaml`
   in the repo root. Render reads the `services[0]` block -- name
   `webmcp-pattern-research-api`, Python runtime, `rootDir: backend` -- and
   shows a preview of what it's about to create. Confirm.
4. Render will prompt for the two env vars marked `sync: false` in
   `render.yaml` (it does not, and must not, get real values from the
   committed file):
   - `EODHD_API_KEY` -- see [`backend/.env.example`](../../../backend/.env.example)
     for where to get a free-tier key. Nothing in the mock-data deploy
     actually calls EODHD yet (that's T-1001-9); set it anyway so the var
     exists for when that ticket lands and reuses this same service.
   - `CORS_ALLOWED_ORIGINS` -- **do not set this yet**. You don't have the
     frontend's real `*.pages.dev` URL until step 2 is done. Set it to
     `http://localhost:5173` for now (matches the code's own local-dev
     default) and come back to this in step 2.5 once the frontend URL
     exists.
5. Deploy. Watch the build log: `pip install uv`, then `uv sync --frozen`,
   then either a skip (`test -f data/mock/panel.parquet`) or a fresh
   `uv run python scripts/generate_mock_panel.py` on the very first deploy
   (subsequent deploys reuse the panel already sitting on the persistent
   disk mounted at `backend/data` -- see `render.yaml`'s `disk` block for
   why that path was chosen).
6. Once live, note the service's public URL, e.g.
   `https://webmcp-pattern-research-api.onrender.com`. `render.yaml`
   configures `healthCheckPath: /api/spike/ping`, so Render's own health
   check is already your first live-request proof -- confirm it's green in
   the Render dashboard before moving on.

### If the free-tier build/runtime combination doesn't work as configured

`render.yaml` defaults to `plan: "free"`. Free-tier Render web services
sleep after 15 minutes idle and cold-start on the next request (multiple
seconds) -- fine for validating the deploy, bad for the demo recording
(see `docs/plan.md`'s risk log). Before recording, change `plan` to
`"starter"` in `render.yaml` and redeploy, or upgrade the plan directly in
the Render dashboard (dashboard changes don't need a redeploy, but drift
from the committed blueprint -- prefer editing `render.yaml`).

---

## 2. Frontend: deploy to Cloudflare Pages

1. Create a Cloudflare account (or sign in) at <https://dash.cloudflare.com>.
2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
   Select this repo and the branch you're deploying.
3. Build configuration:
   - **Framework preset**: SvelteKit (if offered) or **None** -- either
     way, the settings below are what actually matter, and
     `@sveltejs/adapter-static` doesn't need Cloudflare's SvelteKit-adapter
     special-casing (that's for `adapter-cloudflare`, not what this repo
     uses -- see `vite.config.ts` for why `adapter-static` was chosen: the
     app is a pure client-side SPA with no server routes).
   - **Build command**: `npm run build`
   - **Build output directory**: `build`
   - **Root directory**: `/` (repo root -- the frontend isn't under a
     subdirectory the way the backend is).
4. **Environment variables** (build-time, not runtime -- SvelteKit's
   `PUBLIC_*` convention bakes these into the static bundle at build time,
   so they must be set here, not left for later):
   - `PUBLIC_API_BASE_URL` = the Render backend URL from step 1.6, e.g.
     `https://webmcp-pattern-research-api.onrender.com`. See
     [`.env.example`](../../../.env.example) for this var's local-dev
     default.
5. Deploy. Cloudflare Pages builds and serves from `*.pages.dev` over
   HTTPS automatically (AC3) -- no certificate setup needed.
6. Note the deployed URL, e.g. `https://webmcp-stock-screener.pages.dev`.

### 2.5 Close the CORS loop

Go back to the Render dashboard (or `render.yaml`) and set
`CORS_ALLOWED_ORIGINS` to the real Cloudflare Pages URL from step 2.6
(comma-separate multiple origins if you keep a preview deployment URL
too, e.g. `https://webmcp-stock-screener.pages.dev,https://<preview-hash>.webmcp-stock-screener.pages.dev`).
Redeploy the backend so the new value takes effect (`main.py` reads
`CORS_ALLOWED_ORIGINS` once at process startup -- see `_allowed_origins`).

---

## 3. Verify

### HTTPS (AC3)

```bash
curl -I https://webmcp-pattern-research-api.onrender.com/api/spike/ping
curl -I https://webmcp-stock-screener.pages.dev
```

Both should connect over TLS (curl fails outright on a bad cert) and
return 2xx/redirect status, not connection errors.

### Backend reachable, serving mock data (AC1)

```bash
curl https://webmcp-pattern-research-api.onrender.com/api/spike/ping
```

Expect a 200 with a JSON body shaped like
`{"message": "pong from a live FastAPI backend", "sample": {...}}` --
this is the only route registered in `backend/main.py` as of this
ticket (T-1001-2's spike endpoint). If T-1001-5's five networked tool
endpoints have landed by the time you run this, re-check
`backend/main.py` for what's actually registered and prefer curling one
of those instead -- they're the real product surface this spike endpoint
was always going to be superseded by.

### Frontend reachable and talking to the backend (AC2)

Open `https://webmcp-stock-screener.pages.dev` in a browser, open dev
tools' Network tab, and trigger the spike tool (via `/spike` or `/dev` --
check `src/routes/` for what's live) or a real product tool once T-1001-5
lands. Confirm the request goes to the `PUBLIC_API_BASE_URL` origin (not
`localhost`) and gets a 200 back.

### Rate limiting is live (AC4)

```bash
for i in $(seq 1 65); do
  curl -s -o /dev/null -w "%{http_code}\n" https://webmcp-pattern-research-api.onrender.com/api/spike/ping
done | sort | uniq -c
```

With the default `RATE_LIMIT_DEFAULT=60/minute`, expect ~60 `200`s and
the remainder `429`s within that burst. See
`backend/tests/functional/test_deploy_ops.py` for the equivalent
automated check (against a lowered, deterministic test-only threshold --
run against real hosting here to confirm the *deployed* config, not just
the code, enforces it).

### Full example research session (AC5)

This exercises the product's actual WebMCP tool flow (`findInstances` →
`measure`/`showGrid`/`sampleInstances`/`splitInstances`) against the
deployed backend, per T-1001-5's acceptance criteria and
`docs/design/pattern-research-workbench/spec.md`'s Preconditions section.
It is **not achievable yet on this branch**: `src/lib/webmcp/spike.ts` is
hardcoded to `http://localhost:8000` on purpose (T-1001-2 was only ever
proving the round trip works at all), and none of T-1001-5's five
networked tools exist yet to wire `PUBLIC_API_BASE_URL` into. Once
T-1001-5 (tool wiring) and T-1001-6/7 (frontend shell + visualization)
have landed, repeat this section: drive a full session -- define a study,
find instances, measure outcomes, view the grid -- through a WebMCP-capable
agent runtime against the URLs from steps 1 and 2, exactly as a real user
or judge would.

---

## Reference

- [`render.yaml`](../../../render.yaml) -- backend blueprint (source of
  truth for the Render service's build/start commands, env vars, disk).
- [`vite.config.ts`](../../../vite.config.ts) -- frontend adapter config.
- [`static/_redirects`](../../../static/_redirects) -- Cloudflare Pages
  SPA fallback rule.
- [`backend/.env.example`](../../../backend/.env.example),
  [`.env.example`](../../../.env.example) -- what every config var means
  and its local-dev default; this runbook only says where each one gets
  set in production, not what it does.
- `docs/plan.md` -- the hosting decision log (Render + Cloudflare
  Pages/Vercel), HTTPS requirement (WebMCP is `[SecureContext]`), and
  rate-limiting decision this runbook and `backend/main.py` implement.
