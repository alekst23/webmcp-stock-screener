# WebMCP Pattern Research Workbench

A browser-based hypothesis workbench for stock price patterns, exposed to an AI
agent over [WebMCP](docs/reference/webmcp-guide.md). The atom is a
`(ticker, date)` **event**, not a ticker: the agent defines studies and setups,
finds instances, measures outcomes, and renders panels the human can see and
manipulate in the same UI. See [`docs/tools.md`](docs/tools.md) for the tool
surface.

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
  is unset (`src/routes/+page.svelte`).
- The backend's CORS defaults to `http://localhost:5173`
  (`_allowed_origins()` in `backend/main.py`).
- `EODHD_API_KEY` is only needed for the data-ingestion work, not for serving.

Health check that the backend is really up — returns a pong plus a sample bar
from the mock panel:

```bash
curl localhost:8000/api/spike/ping
```

There is also a `/dev` route (`src/routes/dev/+page.svelte`), a harness for
exercising the tool bridge directly.

### Mock data

The backend serves a deterministic synthetic panel from
`backend/data/mock/panel.parquet`, which is committed and present. If it ever
goes missing, regenerate it (takes seconds):

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
  `EODHD_API_KEY`, `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_DEFAULT`

Never commit real values.

## Deployment

The backend deploys to Render via the [`render.yaml`](render.yaml) blueprint;
the frontend is a static SPA served by Cloudflare Workers
([`wrangler.jsonc`](wrangler.jsonc)). Neither is applied automatically by this
repo — see [`docs/reference/deployment.md`](docs/reference/deployment.md).

## Docs

- [`docs/plan.md`](docs/plan.md) — project plan and decision log
- [`docs/tools.md`](docs/tools.md) — WebMCP tool surface
- [`docs/design/`](docs/design/) — feature specs
- [`docs/reference/`](docs/reference/) — data provider, deployment, WebMCP notes
