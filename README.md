# MarketPane

A browser-based stock screener and research workbench, exposed to an AI agent
over [WebMCP](docs/reference/webmcp-guide.md). An agent and a human share one
workspace: build a filter tree over a universe of instruments, run it, inspect
and chart the results, find historically similar setups, and act on what you
find — all through the same panel grid, live in the UI. See
[`docs/tools.md`](docs/tools.md) for the tool surface.

Two parts:

| Part | Stack | Dev port |
| --- | --- | --- |
| Frontend (`src/`) | SvelteKit 5 (SPA, `adapter-static`) + the WebMCP tool bridge | 5173 |
| Backend (`backend/`) | Python 3.10 + FastAPI + pandas, managed with `uv` | 8000 |

## Running locally

Two terminals.

**Terminal 1 — backend:**

```bash
cd backend
uv run uvicorn main:app --reload
```

**Terminal 2 — frontend:**

```bash
npm run dev
```

Then open <http://localhost:5173>.

No env setup is needed for local dev — the defaults on both sides line up:

- The frontend falls back to `http://localhost:8000` when `PUBLIC_API_BASE_URL`
  is unset (`resolveApiBaseUrl` in `src/lib/workspace/apiConfig.ts`).
- The backend's CORS defaults to `http://localhost:5173`
  (`_allowed_origins()` in `backend/main.py`).
- `EODHD_API_KEY` is only needed for the data-ingestion work, not for serving.

Health check that the backend is really up — liveness only, no panel or
object-store dependency:

```bash
curl localhost:8000/health
```

There is no separate manual tool-harness route — the app itself, at `/`, is
the only surface (the legacy `/dev` route was retired in EPIC-1015).

### Mock data

The backend serves a deterministic synthetic panel from
`backend/data/mock/panel.parquet` when no real object-store-backed panel is
configured (the default for local dev). That file is gitignored, not
committed — generate it once per checkout (takes seconds; verified: writes
19,550 rows for 25 tickers):

```bash
cd backend
uv run python scripts/generate_mock_panel.py
```

## Other commands

```bash
npm test               # Vitest, src/**/*.test.ts
npm run typecheck      # svelte-check
npm run build          # static build into build/

cd backend && uv run pytest    # backend unit + functional tests
```

## Configuration

Copy the example files if you need to override a default:

- [`.env.example`](.env.example) → `.env` — frontend (`PUBLIC_API_BASE_URL`)
- [`backend/.env.example`](backend/.env.example) → `backend/.env` —
  `EODHD_API_KEY`, `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_DEFAULT`, plus the
  `OBJECT_STORE_*`/`REQUIRE_REAL_PANEL` variables that switch the backend
  from the mock panel to a real object-store-backed one (see
  [`docs/reference/data-provider.md`](docs/reference/data-provider.md))

Never commit real values.

## Deployment

The backend deploys to Render via the [`render.yaml`](render.yaml) blueprint;
the frontend is a static SPA served by Cloudflare Workers
([`wrangler.jsonc`](wrangler.jsonc)). Neither is applied automatically by this
repo — see [`docs/reference/deployment.md`](docs/reference/deployment.md).

## Docs

- [`docs/plan/project.md`](docs/plan/project.md) — current project status and
  decision log
- [`docs/tools.md`](docs/tools.md) — WebMCP tool surface
- [`docs/design/`](docs/design/) — feature specs
- [`docs/reference/`](docs/reference/) — data provider, deployment, WebMCP notes
