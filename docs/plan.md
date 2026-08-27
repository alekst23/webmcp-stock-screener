# Project Plan — WebMCP Pattern Research Workbench

As of 2026-08-26. Deadline: Sep 3, 2026, 1:00 PM PT (~8 days).

## Devpost WebMCP Challange
##### TODO: Finish registration webform
https://devpost.com/submit-to/31011-the-webmcp-challenge/manage/submissions/1155684-stock-screener/project_details/edit

## Decision log

- **2026-08-26 — Universe size.** Originally scoped to ~600 curated tickers
  (S&P 500 + a Nasdaq slice), client-side only. Rejected: real coverage is
  ~3,900 operating companies with common stock across NYSE+Nasdaq (Ritter
  "listed firms" methodology, year-end 2025: Nasdaq 2,325 + NYSE 1,588;
  a looser "all listings" count including multiple share classes, ADRs,
  SPACs, closed-end funds runs ~5,650). 600 tickers is 10–17% of that, and
  it's the *wrong* 15% — S&P 500 + liquid-Nasdaq systematically excludes
  small/micro-caps, which is where sharp gap/breakout/contraction patterns
  concentrate. Decision: pull the server-side engine forward into the
  hackathon build (see Components/Work plan below) to cover the full
  universe, rather than shipping a demo-scoped subset. Adds ~1.5–2 days;
  accepted given the deadline.
- **2026-08-26 — Data provider.** Chose EODHD's EOD Historical Data plan
  ($19.99/mo) over stitching together free sources (Stooq/yfinance). Bulk
  scanning across the full universe needs our own query engine regardless
  of source (no provider answers "find me all instances of this temporal
  pattern"), so the provider is purely an ingestion-time input, not a
  runtime dependency. See [`docs/reference/data-provider.md`](reference/data-provider.md)
  for the full writeup (endpoints, volume, cost).
- **2026-08-26 — Backend stack.** Switched from a Cloudflare Worker (TS)
  engine + R2 storage to **Python + FastAPI**, managed with **uv**, deployed
  on **Render** (Web Service + persistent disk + Cron Job), storing the
  panel as **Parquet**. Reasons: (1) the two hardest engineering risks in
  this plan — the expression evaluator and the temporal sequence matcher —
  are substantially de-risked by pandas/numpy (`rolling`, `groupby`,
  `shift`, vectorized boolean masks) versus hand-rolled TS array code; (2)
  the data pipeline was already Python, so this collapses pipeline + engine
  + API into one language; (3) Render is on the hackathon's approved host
  list and has a sponsor prize attached. Cost: gives up Cloudflare's edge
  latency, judged not to matter since network round-trip dominates either
  way. Does not require touching any already-built WebMCP code — the
  `ResearchEngine` TS interface never assumed the server was TypeScript;
  `execute()` for the 5 networked tools just becomes `fetch()` against
  FastAPI JSON endpoints. R2 was considered and rejected in favor of a
  Render persistent disk to avoid a second cloud provider/credential set
  for an 8-day build.
- **2026-08-26 — Frontend framework.** Svelte, not React. Matches the
  house style already documented in the user's global engineering
  standards (tabs, single quotes, `prettier-plugin-svelte` — already
  reflected in this repo's `.prettierrc`). The UI is hand-rolled canvas/SVG
  visualization rather than component-library-heavy, so React's ecosystem
  advantage isn't exercised here.

## What we are screening

**US common stocks, adjusted daily OHLCV, ~8–10 years of history, full
NYSE + Nasdaq common-stock universe (~3,900–4,500 tickers depending on
filtering).** Per-ticker metadata: sector, market-cap bucket, and — if a
source works out — historical earnings dates (needed for
`days_since_earnings`, a demo beat).

Explicitly **not** screening: intraday data, options, or historical
fundamentals time series. A *current-snapshot* fundamentals CSV (P/E,
profitability flags) may be included for universe filtering only, clearly
labeled as point-in-time — no pretend historical fundamentals.

The atom is the `(ticker, date)` event; everything (studies, setups,
instance sets, measurements) derives from the OHLCV panel at query time.

## Where the data comes from

**Build-time pipeline feeding a server-held panel — no live third-party API
in the request path.** A Python script backfills and maintains the panel;
it lives behind our own FastAPI service, not in the browser. Full detail
(endpoints, cost, volume): [`docs/reference/data-provider.md`](reference/data-provider.md).

- **Source: EODHD**, EOD Historical Data plan ($19.99/mo). Per-ticker range
  endpoint for the one-time backfill (1 call/ticker, any date length);
  bulk-by-exchange endpoint for the nightly delta (100 quota units/night).
- **Storage: Parquet on a Render persistent disk**, read directly by the
  FastAPI service via pandas/pyarrow — ~60–90 MB for the full backfill,
  ~20–30 KB/night for the delta. This is the number that made
  client-side-only infeasible — the browser was never going to hold this.
- Metadata (sectors, market caps, earnings dates) as a small JSON/Parquet
  side table.

Metadata sourced separately (not from EODHD's pricier Fundamentals tier):

| Source | For | Notes |
|---|---|---|
| Nasdaq screener export | Sector / market cap | Free CSV, static enough not to need a live feed |
| TBD | Earnings dates | Nice-to-have for `days_since_earnings`; not a blocker — see data-provider.md |

**Data layout: immutable base + daily deltas**, on the server: the base
panel (10 y) is built once via backfill; a nightly Render Cron Job pulls
the bulk-by-exchange delta and appends it to the Parquet file, then the
FastAPI service reloads. No manual daily pipeline runs.

**Licensing is actually easier under this design, not harder.** The raw
panel never leaves our infrastructure — the client only ever receives
derived results (instance windows, measurements, study values for a
handful of tickers), which is the redistribution boundary licensed feeds
generally do allow. EODHD's API terms explicitly permit building products
on top of the data, unlike ad-hoc free CSV scraping. Still label everything
"data as of <date>, educational demo" and keep the pipeline script in the
repo so provenance is transparent.

## Sessions: anonymous, no users — but now there is a backend

**No auth, no accounts.** There is now a backend (the FastAPI service +
Parquet panel from the decision above), but it's stateless per request — no
user identity, no sessions server-side. Decision, with reasons:

1. Workspace *state* (studies, setups, sets, panels, selection) stays
   client-side and ephemeral to the tab; the server only answers stateless
   queries (`findInstances`, `measure`, etc.) against the shared panel. The
   server never needs to know who's asking.
2. Persistence = localStorage/IndexedDB per browser for workspace state;
   sharing = export/import JSON or a workspace-encoding URL (stretch goal).
   Covers "save my screen" without user accounts.
3. Auth earns zero judging points and costs days we don't have.
4. Security posture: WebMCP tools running inside an *authenticated* session
   is exactly where prompt-injection consequences get scary. A stateless,
   read-only backend with no per-user identity makes the worst case "agent
   ran a weird query," not "agent moved money" or "agent touched another
   user's data." This is a feature, and worth a line in the submission
   text.
5. Follow-on from the universe decision: the API needs basic abuse
   protection (rate limiting) since it's now a real public endpoint doing
   real compute, not a static file. A small FastAPI middleware
   (`slowapi` or equivalent) is sufficient at this scale — no need to build
   anything custom.

The `toolchange` story doesn't need login-gating — workflow-based unlocking
(measure appears after findInstances) is stronger and already built.

## Risks and caveats

Ordered by severity:

1. **Platform access (existential).** WebMCP needs Chrome Canary behind a
   flag / signup-gated Early Preview Program, or ChatGPT's in-app browser.
   If we can't get a real agent to call our tools end-to-end, there is no
   submission. → Day-1 spike: one page, one tool, verified on the actual
   target platform(s). Everything else waits on this proof.
2. **Spec drift.** `document.modelContext` vs `navigator.modelContext`,
   whether `unregisterTool` exists (our dynamic-registration flex depends on
   it), declarative attributes in flux. → All WebMCP contact is isolated in
   `register.ts`; fallback if unregistration is unsupported: register
   everything upfront, return "not yet available: first run findInstances"
   errors from gated tools.
3. **ChatGPT-browser unknowns.** Schema feature support, tool-count or
   description-length limits — untested. → Test with our real 9 tools during
   the day-1 spike, not at the end.
4. **Expression-language scope creep.** The parser is the deepest
   engineering pit. → Catalog frozen at ~12 functions; timeboxed; errors
   return the catalog (already designed). Lower-risk than originally
   assessed now that evaluation runs on pandas/numpy rather than hand-rolled
   TS — most catalog functions (`sma`, `ema`, `atr`, `highest`, `lowest`)
   are thin wrappers over pandas rolling/window ops.
5. **Temporal matcher correctness.** Off-by-one/lookahead bugs produce
   confidently wrong statistics — worse than crashing. → Synthetic-fixture
   unit tests where expected matches are hand-computable. Also lower-risk
   post-pivot: `shift()`/`groupby('ticker')` handle the lookback/lookahead
   bookkeeping that was the main source of off-by-one bugs in a hand-rolled
   version.
6. **Survivorship bias.** A snapshot of *current* listed companies excludes
   delisted losers, inflating every measured edge. → Disclose prominently in
   the UI; frame all stats as "in this sample."
7. **Financial-advice optics.** Permanent disclaimer; framing is "pattern
   research education," never signals or advice.
8. **Own-API reliability during the demo.** 5 of 9 tools' `execute` calls
   cross the network to our FastAPI service — a slow or cold-started
   service mid-recording kills the take, in a way a client-side engine
   couldn't. → More controllable than a third-party API (no rate limits,
   no external outage), but still: keep the Render service warm before
   recording (Render free/starter tiers can cold-start after idling — check
   the plan tier), have a recorded-fallback clip of each tool call as
   insurance, and keep p50 latency low by pre-loading the Parquet panel
   into memory at service startup rather than reading from disk per
   request.
9. **Demo/submission time.** Video + write-up + deploy eat the last 2 days,
   and this decision added ~1.5–2 days of infra work up front.
   → Feature freeze Sep 1; the 3-minute video is most of what gets judged.

## Components

```
┌─ Render Cron Job (nightly) ──────────────┐
│ pipeline (Python): pull EODHD delta      │
│   → append to panel.parquet              │
└──────────────┬────────────────────────────┘
               ▼ writes (shared persistent disk)
┌─ Render Web Service ───────────────────────────────────┐
│ panel storage: panel.parquet + metadata (sectors, mcap,  │
│   earnings dates) — loaded into memory at startup          │
│ engine (Python, pandas/numpy):                              │
│   expression parser/evaluator · temporal matcher             │
│   (rolling/groupby/shift) · stats (measure/base-rate/split)  │
│ API: FastAPI, one route per engine method, JSON in/out        │
│ env: uv-managed venv                                            │
└──────────────┬───────────────────────────────────────────────┘
               ▼ HTTP (instance windows / measurements only —
                 never the raw panel)
┌─ browser ───────────────────────────────────────────────┐
│ UI (Svelte): small-multiples grid · focus chart ·        │
│   histogram · workspace sidebar (human-editable) ·        │
│   selection tracking · agent activity feed                │
│ workspace state: client-side only (studies/setups/sets/    │
│   panels/focus) — ephemeral to the tab, no server identity │
│ webmcp layer (built ✅): tools.ts + register.ts, execute()  │
│   calls the FastAPI API instead of an in-page engine         │
│ dev harness: debug panel invoking tools manually             │
│   (develop without Canary; also our test rig)                │
└─────────────────────────────────────────────────────────┘
```

The `ResearchEngine` interface built in `types.ts` is what makes this split
free: the tool layer never knew whether `execute` resolved locally or over
the network, so moving the engine behind an API changed `register.ts`'s
wiring, not the tool specs, schemas, or availability logic already built
and tested — nor does it care that the API is Python rather than TS.

- **Frontend:** Svelte + TypeScript, deployed to Cloudflare Pages/Vercel
  (either is fine — it's static; only the backend needs Render). HTTPS
  mandatory end to end (WebMCP is `[SecureContext]`).
- **Backend:** Python + **FastAPI**, dependency/venv management via **uv**,
  deployed as a **Render Web Service**. Panel stored as **Parquet** on a
  Render persistent disk, loaded into memory at startup for low-latency
  reads.
- **Pipeline:** Python (pandas), run once locally for backfill; nightly
  delta runs as a **Render Cron Job** against the same disk the Web Service
  reads.
- Charts: hand-rolled canvas/SVG mini-charts on the frontend. Small
  multiples don't need a charting library; one dependency avoided.
- The **agent activity feed** is a first-class component: every tool call
  the agent makes is visible to the human. It's the trust affordance the
  spec's human-in-the-loop model wants, and it makes the demo legible.

## Work plan

| Days (Aug/Sep) | Focus | Exit criterion |
|---|---|---|
| 26–27 | **Platform spike** (real agent → WebMCP tool → live FastAPI round trip on Render) + EODHD backfill for full universe | Agent calls a tool on the target platform and gets a real API response |
| 27–29 | Engine: FastAPI + pandas/numpy — parser, evaluator, temporal matcher, stats + tests; deployed on Render with panel.parquet on the persistent disk | `findInstances`/`measure` correct on synthetic fixtures, callable over HTTP |
| 29–31 | UI: grid, focus view, workspace sidebar, bind WebMCP `execute()` to the live API | Demo workflow runs end-to-end by hand via dev harness against the real API |
| 31–1 | Collaboration polish: activity feed, human edits reflected in `getWorkspace`, earnings dates, disclaimers, latency/caching pass | Full demo script executable with a real agent, acceptable latency |
| 1–2 | **Freeze.** Deploy, submission text, README, license, flip GitHub repo public | Live URL + live API work in target browser(s) |
| 2–3 | Video, buffer, submit morning of Sep 3 | Submitted |

Sequencing logic: the spike now proves the full round trip (agent → tool →
network → engine → back), since that's the compounded existential risk;
the engine precedes UI because it's testable without one and the tool layer
already defines its interface; the video gets real calendar time because
the judges spend more minutes watching it than reading code.

## Deliberately cut

- User accounts, auth, and server-side identity/sessions (the API is
  stateless and anonymous — see Sessions above; there *is* a backend now,
  just not a user one)
- Live third-party market data in the request path, intraday anything
- Historical fundamentals
- Charting libraries
- `forkSetup`, overlay-as-separate-tool, condition registry (folded into
  the 9-tool surface — see [tools.md](tools.md))
