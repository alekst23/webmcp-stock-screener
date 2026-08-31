# Project Plan

## Objective

Ship the WebMCP-native Pattern Research Workbench for the WebMCP hackathon
(deadline **2026-09-03, 1:00pm PT**) — a shared human+agent research session
where a user and their AI agent define chart patterns, search historical
data for matching instances, and evaluate whether the pattern holds up,
entirely through the app's WebMCP tool surface. See
`docs/plan/EPIC-1001/_epic.md` for full scope.

## Current Phase

Human-gated verification and deployment. The core product (engine,
WebMCP tool wiring, frontend shell + visualization) is functionally
complete against the mock dataset. The remaining path to submission runs
through two tickets that require hands-on human action an autonomous
coding agent cannot perform, followed by paid real-data integration and
submission packaging.

**Why this phase:** T-1001-2 (live verification) and T-1001-8 (deployment)
each have a runbook explicitly written for a human to execute — real
WebMCP browser + real AI agent for one, real Render/Cloudflare accounts
for the other. T-1001-9 (real data) and T-1001-10 (submission) are
sequenced behind those by design.

## Active Work

| Item | Type | Status | Branch | Notes |
|------|------|--------|--------|-------|
| EPIC-1001: WebMCP Pattern Research Workbench | epic | in-progress | `epic/EPIC-1001-pattern-research-workbench` (merged to main) | 7/10 tickets done (1,3,4,5,6,7); 2 blocked (2,8); 2 open pending those (9,10) |
| T-1001-2: Platform spike (live verification) | ticket | blocked, in-progress | — | User is live-testing now via ChatGPT Codex acting as the real AI agent against the runbook |
| T-1001-8: Deploy & ops (mock) | ticket | blocked | — | Needs human to create Render + Cloudflare accounts and follow `T-1001-8-deployment-runbook.md` |
| Uncommitted ticker-charts extension | in-progress | uncommitted on `main` | — | ChatGPT Codex is actively editing `types.ts`, `apiEngine.ts`, `store.ts`, `GridPanel.svelte`, `HistogramPanel.svelte`, `WorkspaceView.svelte`, both page routes — adding a `ShowTickerCharts` panel/tool and a browser-persisted instance-set cache. Per user, Codex does not have the design spec in hand. **Do not touch until the live session ends.** |

## Backlog

1. **Reconcile the uncommitted ticker-charts diff** once the user's Codex
   session ends — review against `docs/design/pattern-research-workbench/spec.md`
   and architecture conventions, finish/add tests, commit properly (new
   ticket doc or folded into T-1001-7's notes as appropriate).
2. **Record T-1001-2's outcome** once the live-verification session
   completes — update ticket status to Done and append the outcome per
   the runbook's "Record the outcome (AC5)" section.
3. **User runs the T-1001-8 deployment runbook** (Render + Cloudflare
   accounts, credit card) — human action, no agent can do this.
4. Once T-1001-8 is verified done: start **T-1001-9** (real data
   pipeline) — `/at-ticket-start T-1001-9`. The ~$20/mo EODHD upgrade is
   pre-approved (see Decisions Log) — proceed without re-asking.
5. Once T-1001-9 is done: start **T-1001-10** (submission package) —
   `/at-ticket-start T-1001-10`.

## Blockers

| Blocker | Affects | Since | Action needed |
|---------|---------|-------|----------------|
| T-1001-2 unverified | T-1001-2 | 2026-08-30 | Human + real WebMCP browser + real AI agent must complete `T-1001-2-live-verification-runbook.md`. User is currently doing this via ChatGPT Codex. |
| T-1001-8 undeployed | T-1001-8, T-1001-9, T-1001-10 | 2026-08-30 | Human must create Render + Cloudflare accounts and follow `T-1001-8-deployment-runbook.md`. |
| Live external edit in progress | Uncommitted ticker-charts work | 2026-08-30 | ChatGPT Codex is editing files on `main` outside this session's visibility and without the design spec. Do not launch any agent touching these files until the user's session ends; then reconcile against spec before committing. |

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-30 | Pre-approved the ~$20/mo EODHD paid-tier upgrade for T-1001-9, to proceed automatically once T-1001-8 unblocks it | Deadline is 2026-09-03 1pm PT; avoids re-asking mid-crunch |
| 2026-08-30 | Uncommitted ticker-charts/instance-cache work (started by ChatGPT Codex) will be finished rather than discarded | User confirmed this is live in-progress work worth keeping, not scratch |

## Completed

_EPIC-1001 is still in progress — nothing to record at the epic level yet.
Ticket-level completions (T-1001-1, 3, 4, 5, 6, 7) are tracked in
`docs/plan/EPIC-1001/_epic.md`._

## Last Run

- **Date:** 2026-08-30
- **Actions taken:** Bootstrapped this plan file. Fixed stale status docs
  (T-1001-3 was actually Done, both its ticket file and the epic table
  still said Open). Assessed full ticket state. Discovered a live,
  concurrent editing session (ChatGPT Codex, driven by the user) touching
  files on `main` — held off on any execution wave to avoid conflicting
  with it.
- **Next suggested:** Re-run `/at-project-go` once the Codex live-testing
  session ends, to reconcile the uncommitted diff and record T-1001-2's
  verification outcome.
