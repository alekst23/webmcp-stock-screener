# T-0001-2: Live verification runbook

This is a handoff document, not something the implementing agent executes
itself. AC1 ("discoverable by a real AI agent running in a browser"), AC2
("the agent can successfully invoke the tool ... and receive a structured
result"), and AC5 ("the full round trip is demonstrated ... and its outcome
recorded") require a real WebMCP-capable browser and a real AI agent
attached to it — neither of which an autonomous coding agent can drive.
This runbook is the exact set of steps a human needs to follow to complete
those three ACs.

What the implementing agent already verified mechanically (AC3/AC4 — the
network-and-backend half of the round trip): a locally running FastAPI
process actually serves `GET /api/spike/ping`, reads a live row out of
`backend/data/mock/panel.parquet`, and returns it over real HTTP with CORS
headers a browser will accept. See `backend/tests/functional/test_spike_ping.py`
and the "What already-verified evidence looks like" section below. What is
**not** verified, and is the actual purpose of this runbook, is a real agent
discovering and invoking the tool through `document.modelContext` in an
actual browser tab.

## 1. Prerequisites

- `uv` installed (backend dependency/venv manager).
- Node.js + `npm` installed (frontend).
- A WebMCP-capable browser. Per `docs/reference/webmcp-guide.md` (§4), as of
  this writing that means **Chrome Canary**, with WebMCP enabled via a flag:
  1. Open `chrome://flags` directly in Chrome Canary and search for
     "WebMCP" or "model context" — the guide notes the exact flag name is
     inconsistent across sources (`#enable-webmcp-for-testing` vs.
     `#enable-webmcp-testing`), so search rather than typing either string
     blind.
  2. Chrome's WebMCP early preview may additionally require enrollment in a
     signup-gated program (see
     [developer.chrome.com/blog/webmcp-epp](https://developer.chrome.com/blog/webmcp-epp)).
     If the flag isn't present at all, this is the likely reason — enroll
     first.
  3. Restart the browser after flipping the flag.
- A real AI agent that can attach to that browser tab and drive
  `document.modelContext` (e.g. a browser extension agent, or an in-browser
  assistant that supports WebMCP tool discovery). The specific agent isn't
  prescribed by this ticket — whatever the actual target platform for the
  project's Devpost submission is should be used here, since "the
  browser/device configuration confirmed working here should be the one
  used for the actual submission demo" (per the ticket's Technical
  Considerations).

## 2. Start the backend

```bash
cd backend
uv sync                                   # first time only
uv run python scripts/generate_mock_panel.py   # writes backend/data/mock/panel.parquet
uv run uvicorn main:app --reload --port 8000
```

Leave this running. Sanity-check it directly before involving a browser:

```bash
curl -s http://localhost:8000/api/spike/ping
```

Expect a JSON body shaped like:

```json
{
	"message": "pong from a live FastAPI backend",
	"sample": {
		"ticker": "MOCK01",
		"date": "2023-01-03",
		"open": 157.5079,
		"high": 158.1784,
		"low": 155.355,
		"close": 156.6312,
		"volume": 281036
	}
}
```

If instead you get a `503` with a message about the panel not being found,
the `generate_mock_panel.py` step above was skipped or wrote to a different
path than `backend/data/mock/panel.parquet` — rerun it.

## 3. Start the frontend

```bash
npm install     # first time only, from the repo root
npm run dev      # defaults to http://localhost:5173
```

**Quirk discovered during implementation:** Vite's dev server auto-increments
to the next free port (5174, 5175, ...) if 5173 is already in use — e.g. by
another dev server or a previous run left dangling. The backend's CORS
allowlist (`CORS_ALLOWED_ORIGINS`, default `http://localhost:5173` — see
`backend/.env.example`) only permits that exact origin by default. If the
terminal output shows Vite bound to a port other than 5173, either free
5173 and restart `npm run dev`, or restart the backend with
`CORS_ALLOWED_ORIGINS=http://localhost:5174 uv run uvicorn main:app --reload --port 8000`
matching whatever port Vite actually chose. A same-origin mismatch here
shows up as a browser-console CORS error on the fetch, not a 4xx/5xx from
the server — worth knowing so it isn't mistaken for a backend bug.

## 4. Open the spike page

Navigate the WebMCP-capable browser (Chrome Canary, flag enabled — see §1)
to:

```
http://localhost:5173/spike
```

(adjust the port if step 3's quirk applied). This page:

- Registers exactly one tool, `spikePing`, against
  `document.modelContext` on load (see `src/lib/webmcp/spike.ts` and
  `src/routes/spike/+page.svelte`).
- Shows two status lines: whether `document.modelContext` exists in the
  current browser, and whether the tool registration call succeeded.
- Has a "Call spikePing() directly" button that runs the same `fetch()`
  code path as the tool's `execute()`, without needing an agent — useful to
  confirm the network path works in this browser/profile before bringing
  an agent into the loop, but this button alone does **not** satisfy
  AC1/AC2 (it's a human click, not an agent-driven tool invocation).

If "WebMCP supported in this browser" shows "no", stop and revisit §1 — no
amount of agent setup will help until `document.modelContext` exists.

## 5. Drive it with a real agent

With the page open and both status lines reading "yes":

1. Attach the chosen AI agent to this browser tab (mechanism depends on the
   agent/platform — e.g. a browser-extension agent's own UI, or whatever
   the target Devpost submission platform provides).
2. Ask the agent to discover available tools on the page, or simply ask it
   a question that should prompt it to look for one (e.g. "call the
   spikePing tool and tell me what it returned"). It should find
   `spikePing` with the description defined in `src/lib/webmcp/spike.ts`
   (AC1).
3. Have the agent invoke `spikePing` (it takes no arguments) and report
   back the result (AC2).
4. While the agent is invoking it, watch the backend's terminal (from §2) —
   a new `GET /api/spike/ping` access log line should appear at the moment
   of invocation. This is the confirming evidence that the tool's
   `execute()` made a real network request to the separately running
   backend process, not a local/hardcoded response (AC3/AC4, which the
   implementing agent already confirmed mechanically but which this step
   re-confirms end-to-end through the actual agent path).
5. Confirm the structured result the agent received matches the shape from
   §2's curl check: a `message` string and a `sample` object with `ticker`,
   `date`, `open`, `high`, `low`, `close`, `volume`.

## 6. Record the outcome (AC5)

Whatever the result, write it down — this is the point of the whole
ticket. At minimum, capture:

- Which agent/browser/OS combination was used, and the exact Chrome Canary
  version + flag name that worked (the guide notes the flag name is
  inconsistent across sources; record the one that actually worked).
- Whether tool discovery worked unprompted or required explicit prompting.
- The exact result payload the agent reported back, and whether it matched
  the backend's access log (i.e., no discrepancy suggesting the agent
  fabricated or cached a response instead of actually calling the tool).
- Any errors, quirks, or friction — e.g. signup-gate hurdles, flag-name
  confusion, CORS misconfiguration, the agent failing to discover the tool
  on the first attempt, timing/latency, or anything else future tickets
  (especially T-0001-5, which builds the real 9-tool surface on this same
  mechanism) should know about.

A short paragraph or bullet list appended to this file, or filed as a
comment/update on the ticket, is enough — this doesn't need its own
document.

## Appendix: what already-verified evidence looks like

For reference, here's what the implementing agent already confirmed
without a browser, so this runbook's job is narrowly the agent-in-browser
half:

- `backend/tests/functional/test_spike_ping.py` passes: `TestClient` hits
  `GET /api/spike/ping` against the real FastAPI app object and asserts a
  well-formed `SpikePingResponse` with valid OHLC ordering, sourced from a
  freshly (re)generated `panel.parquet`.
- Manual `curl` against a locally running `uvicorn main:app` process (a
  genuinely separate OS process, not an in-process call) returned live data
  and the correct `Access-Control-Allow-Origin` header for
  `http://localhost:5173`.
- `src/lib/webmcp/spike.test.ts` passes: `spikePing()` calls `fetch()`
  against the exact backend URL, propagates HTTP errors as thrown
  `Error`s, and `registerSpikeTool()` both registers a tool descriptor
  named `spikePing` and wires its `execute()` to that same `fetch()` path
  (with a mocked `fetch`/`document.modelContext`, since no real WebMCP
  browser is available in the test environment).

None of this involved a real AI agent or a real WebMCP browser — it proves
the plumbing is correct up to the boundary only a human, with the right
browser and agent, can cross.
