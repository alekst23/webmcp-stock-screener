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
| T-1001-2: Platform spike (live verification) | ticket | blocked | — | Needs human + real WebMCP browser + real AI agent to complete the runbook |
| T-1001-8: Deploy & ops (mock) | ticket | blocked | — | Needs human to create Render + Cloudflare accounts and follow `T-1001-8-deployment-runbook.md` |
| EPIC-1003: Panel Action Set | epic | implemented, awaiting close | `epic/EPIC-1003-panel-action-set` | 2/2 tickets Done (implemented sequentially to avoid `GridPanel.svelte` collision). 31/31 tests pass, clean typecheck. Not yet reviewed or merged. |
| EPIC-1004: WebMCP Status Header | epic | implemented, awaiting close | `epic/EPIC-1004-webmcp-status-header` | 1/1 ticket Done. No `_epic.md` for this single-ticket epic — implemented via `/at-ticket-start` directly since `/at-epic-run` requires one. 30/30 tests pass. Not yet reviewed or merged. |
| EPIC-1005: Workspace Snapshots | epic | implemented, awaiting close | `epic/EPIC-1005-workspace-snapshots` | 2/2 tickets Done. 42/42 tests pass, typecheck/build/prettier clean. Not yet reviewed or merged. |

## Backlog

1. **Close EPIC-1003 through EPIC-1005** — run `/at-epic-close EPIC-NNN` for
   each (CI, 5-agent epic review, PR, then merge — user has approved
   auto-merge after CI/review pass for this batch). Can run in any order;
   the three branches are independent.
2. **Record T-1001-2's outcome** once a human completes the live-verification
   session — update ticket status to Done and append the outcome per
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
| T-1001-2 unverified | T-1001-2 | 2026-08-30 | Human + real WebMCP browser + real AI agent must complete `T-1001-2-live-verification-runbook.md`. |
| T-1001-8 undeployed | T-1001-8, T-1001-9, T-1001-10 | 2026-08-30 | Human must create Render + Cloudflare accounts and follow `T-1001-8-deployment-runbook.md`. |

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-30 | Pre-approved the ~$20/mo EODHD paid-tier upgrade for T-1001-9, to proceed automatically once T-1001-8 unblocks it | Deadline is 2026-09-03 1pm PT; avoids re-asking mid-crunch |
| 2026-08-30 | Uncommitted ticker-charts/instance-cache work (started by ChatGPT Codex) was finished rather than discarded | User confirmed this is live in-progress work worth keeping, not scratch — landed in commit `2b039af` |
| 2026-08-31 | Ran EPIC-1002 through EPIC-1005 (all triaged from #2-#5, specs already written) through design/tests/implementation this run, per explicit user instruction via `/loop`, despite autonomous-mode's normal "no new initiatives" restriction | User's `/at-project-go` argument explicitly named these four epics; they were already triaged with specs, not brand-new scope |
| 2026-08-31 | Ran `/at-epic-close` (CI + 5-agent review + PR) for EPIC-1002 through EPIC-1005 per explicit user instruction ("close all and merge to main") via `/loop` | Follow-up to the implementation run; user directed closing all four in this session |
| 2026-08-31 | Asked the user whether to auto-merge each PR or stop at PR creation (the skill's default is to never merge directly); user chose auto-merge each once CI/review pass | `at-epic-close` intentionally never merges on its own — explicit user instruction overrides that default for this batch only |
| 2026-08-31 | EPIC-1002's PR was squash-merged to origin/main via GitHub while local `main` still carried unpushed plan-doc commits, causing a divergent-history merge conflict on reconcile | Resolved by resetting local `main` to origin's tip (a pure superset for all code — origin already contained everything local had via the epic branch's ancestry) and reapplying only the local-only `project.md` tracking edits on top |

## Completed

| Item | Type | Completed | Result |
|------|------|-----------|--------|
| EPIC-1002: Unified Action Log | epic | 2026-08-31 | Merged to main via [PR #6](https://github.com/alekst23/webmcp-stock-screener/pull/6) (squash), closing #2. 5-agent review passed with 2 non-blocking follow-ups filed (T-1002-4, T-1002-5, both Open). |

_EPIC-1001 is still in progress — ticket-level completions (T-1001-1, 3, 4,
5, 6, 7) are tracked in `docs/plan/EPIC-1001/_epic.md`._

## Last Run

- **Date:** 2026-08-31
- **Actions taken:** Per explicit user instruction ("close all and merge to
  main") ran `/at-epic-close` for EPIC-1002: CI passed (37/37 tests, clean
  typecheck/build), merge-queue clean, 5-agent epic review passed with 2
  non-blocking Medium findings filed as follow-up tickets (T-1002-4, T-1002-5).
  Asked the user once whether to auto-merge after CI/review pass across this
  whole batch — approved. Pushed, opened PR #6, squash-merged, issue #2
  auto-closed. Hit a divergent-history conflict reconciling local `main`
  with origin afterward (local had unpushed plan-doc commits; origin's
  squash-merge based off an older local push) — resolved by resetting local
  `main` to origin's tip and reapplying only the plan-doc edits.
  EPIC-1003/1004/1005 still queued for the same close pipeline.
- **Next suggested:** Continue `/at-epic-close` for EPIC-1003, EPIC-1004,
  EPIC-1005 (same CI + review + PR + auto-merge pipeline). After each merge,
  `git fetch && git reset --hard origin/main` locally before starting the
  next one's CI worktree, to avoid the same divergence. Re-check
  T-1001-2/T-1001-8 for human progress.
