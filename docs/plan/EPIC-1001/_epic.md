# EPIC-1001: WebMCP Pattern Research Workbench

**Depends on**: —
**Blocks**: —
**Issue**: #1
**Design**: docs/design/pattern-research-workbench/

## Description

A WebMCP-native pattern research tool where the unit of work is a
`(ticker, date)` event rather than a screened ticker. A user and their AI
agent share one research session, defining derived series and multi-step
temporal patterns, searching a stock universe for matching historical
instances, and visually/statistically evaluating whether a pattern holds
up. Built for the WebMCP hackathon (deadline Sep 3, 2026, 1:00pm PT). Real,
paid market data is deferred until the design is proven end-to-end against
a synthetic dataset.

## User Story

As a trader or researcher (and their AI agent, acting through WebMCP
tools),
I want to define a chart pattern, search history for it, and evaluate
whether it actually predicts anything,
so that I can turn a vague visual hunch into a tested hypothesis, faster
than either of us could alone.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1001-1 | Mock data layer | — | Done |
| 2 | T-1001-2 | Platform spike | T-1001-1 | Blocked — awaiting live human verification |
| 3 | T-1001-3 | Query engine core | T-1001-1 | Done |
| 4 | T-1001-4 | Query engine stats | T-1001-3 | Done |
| 5 | T-1001-5 | WebMCP integration | T-1001-2, T-1001-4 | Done |
| 6 | T-1001-6 | Frontend shell | — | Done |
| 7 | T-1001-7 | Frontend visualization | T-1001-6, T-1001-5 | Done |
| 8 | T-1001-8 | Deploy & ops (mock) | T-1001-4 | Blocked — awaiting live deployment |
| 9 | T-1001-9 | Real data pipeline (paid, deferred) | T-1001-1, T-1001-8 | Open |
| 10 | T-1001-10 | Submission package | T-1001-9 | Open |

## Dependency Graph

```
T-1001-1 ──┬──> T-1001-2 ──┐
           │               ├──> T-1001-5 ──┬──> T-1001-7 ──┐
           └──> T-1001-3 ──> T-1001-4 ──┬───┘               │
                                        └──> T-1001-8 ───────┼──> T-1001-9 ──> T-1001-10
T-1001-6 ───────────────────────────────────────────────────┘
```

## Wave Plan

- **Wave 1** (parallel): T-1001-1, T-1001-6 — no dependencies
- **Wave 2** (parallel): T-1001-2, T-1001-3 — depend on Wave 1's mock data
- **Wave 3**: T-1001-4 — depends on Wave 2's engine core
- **Wave 4** (parallel): T-1001-5, T-1001-8 — depend on Wave 2/3
- **Wave 5** (parallel): T-1001-7, T-1001-9 — depend on Wave 4
- **Wave 6**: T-1001-10 — depends on Wave 5's real data

## Acceptance Criteria

1. A real AI agent, using a real WebMCP-capable browser, can carry out a
   complete research session — define a pattern, search for it, sample and
   measure instances, view results — entirely through this app's WebMCP
   tools, backed by real historical market data.
2. A human using the app at the same time can see everything the agent has
   done, and can make their own edits (selections, definitions) that the
   agent can subsequently see and act on through the shared session state.
3. The app is deployed, publicly reachable, and demonstrated working on
   real data before the submission deadline.
4. The hackathon's submission requirements (public licensed repo,
   description, demo video) are met and filed before the deadline.
5. No cost is incurred until the design has been validated end-to-end
   against synthetic data.

## Design References

- `docs/plan.md` — architecture, stack decisions, risks, work plan, and the
  reasoning behind deferring paid data
- `docs/tools.md` — the 9-tool WebMCP surface, availability rules, design
  rules
- `docs/reference/webmcp-guide.md` — WebMCP API surface, browser support status,
  security model, known limitations
- `docs/reference/webmcp-challenge.md` — hackathon submission requirements, judging
  criteria, deadline
- `docs/reference/data-provider.md` — real data source, endpoints, cost,
  volume

## Out of Scope

- User accounts or authentication of any kind
- Intraday data, options data, historical fundamentals time series
- Any live third-party API call in the request path (data providers are
  ingestion-time only)
- Charting libraries — visualizations are hand-rolled
