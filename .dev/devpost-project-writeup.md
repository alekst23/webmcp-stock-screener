## Inspiration

MarketPane is an AI-assisted research workbench for stock screening. Our goal is to remove the wall between an AI agent and the research canvas, so a user can spend their time refining a hypothesis instead of relaying it back and forth as chat text. By giving the agent real tools over the same workspace the human sees — not a side-channel API — the loop from idea to evidence gets a lot shorter.

## What it does

MarketPane is a WebMCP-powered stock screener and research workbench shared between a human and an agent. Either one can define a screener over a universe of instruments (asset class, exchanges, sectors), build a filter tree of typed conditions, set a ranking, and run it to get a pinned, stable set of results. Results land in a panel grid: a results table the agent or the human can inspect, and — via drag-and-drop or a tool call — individual rows become live price charts on the same canvas. Every panel, chart, and result the agent creates is visible and rearrangeable by the human in real time, and vice versa.

## How we built it

The frontend is SvelteKit 5 (SPA) with a browser-side panel/grid system and a workspace document that both the UI and the WebMCP tool layer read and write. WebMCP tools (`define_screener`, `run_screener`, `get_screener_results`, `create_panel`, `resolve_ticker`, `search_catalog`, `get_canvas_state`) operate on that same document, so an agent's actions show up as first-class panel changes instead of hidden side effects. The backend is a FastAPI service (Python, pandas) that evaluates screeners against an OHLCV panel of real market data (EODHD-sourced, object-store backed) and exposes a stateless `/api/screener/run` endpoint. A typed catalog of fields, operators, and universes keeps every filter condition validated rather than arbitrary code — the agent composes screeners out of known building blocks, it doesn't write expressions the backend has to trust blindly.

## Challenges we ran into

The biggest challenge was scope discipline on a moving tool surface. We designed a much larger ~33-tool surface (workspaces, revisions, similarity search, chart annotation, alerts, backtesting) and got most of it built and tested, but building it all didn't mean it was reachable — tool groups sat fully implemented behind feature flags with no route ever calling them. We had to explicitly wire a minimal composition root back down to just the tools a live agent loop actually needs — define a screener, run it, see the results, chart a row — and prove that thin path works end to end before trying to widen it again. Getting an agent to reliably reach for the right WebMCP tool instead of poking at UI elements also took iteration on how tool schemas and names are surfaced.

## Accomplishments that we're proud of

We're proud that MarketPane's agent loop is real, not scripted: `define_screener` → `run_screener` → `get_screener_results` → `create_panel` is exercised by an actual integration test against the live composition root, running against a real backend evaluation engine and real market data rather than a mock. We're also proud of the shared-state design holding up under a hackathon timeline — an agent can define and run a screener and a human can drag a result straight into a chart on the same panel grid, each side's actions immediately visible to the other.

## What we learned

We learned that agent-ready software needs more than an API — it needs legible, shared state, stable IDs, and a tool surface an agent can actually discover and reach for over guessing at DOM elements. We also learned that "build it all, flag it off" is a trap: a wide, well-tested tool surface is worthless to a demo until something actually calls it, so we now treat wiring a thin vertical slice live as its own deliverable, not an afterthought once every tool exists.

## What's next for MarketPane

Next, we want to widen the live tool surface back toward the fuller design we already built and tested: similarity search ("find setups like this one"), chart annotation and capture, computed fields and custom studies, watchlists, alerts, and backtesting are all implemented behind feature flags today and just need to be wired back into the live composition root. We also want richer chart controls (timeframes, overlays, multi-ticker comparison) and stronger measurement tools so a user can move from spotting a pattern to testing it across cohorts, outcomes, and market regimes — all through the same shared workspace the agent already operates in.
