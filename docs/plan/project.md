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

_EPIC-1002 through EPIC-1005 are fully closed — see Completed below. Each
left 2-3 non-blocking follow-up tickets (Open) on GitHub-deleted epic
branches; those ticket files still exist under `docs/plan/EPIC-100N/` on
`main` for whenever someone picks them up. None are urgent — deadline focus
should stay on EPIC-1001._

## Backlog

1. **Record T-1001-2's outcome** once a human completes the live-verification
   session — update ticket status to Done and append the outcome per
   the runbook's "Record the outcome (AC5)" section.
2. **User runs the T-1001-8 deployment runbook** (Render + Cloudflare
   accounts, credit card) — human action, no agent can do this.
3. Once T-1001-8 is verified done: start **T-1001-9** (real data
   pipeline) — `/at-ticket-start T-1001-9`. The ~$20/mo EODHD upgrade is
   pre-approved (see Decisions Log) — proceed without re-asking.
4. Once T-1001-9 is done: start **T-1001-10** (submission package) —
   `/at-ticket-start T-1001-10`.
5. (Low priority, post-deadline) Pick up the follow-up tickets left by
   EPIC-1002/1003/1004/1005's epic reviews — none are blocking, see the
   Completed table for the ticket IDs and what each covers.

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
| 2026-08-31 | EPIC-1003/1004/1005 all shared the same problem as EPIC-1002 above (forked from a stale pre-EPIC-1002 `main`, causing inflated diffs and would-be merge conflicts) — rebased each onto the current `main` tip before its CI/review pass, resolving real content conflicts (shared `spec.md`/`+page.svelte` sections) by hand each time | Kept each epic's PR diff scoped to its own actual changes instead of re-showing already-merged sibling-epic content, and avoided GitHub-side merge conflicts at squash time |
| 2026-08-31 | EPIC-1005's epic review found one genuine functional bug (loading a snapshot left a stale `focusedView`, risking the chart showing data for the wrong instance) — fixed it directly on the epic branch before opening the PR, rather than filing a follow-up ticket | Unlike the other findings across all four epics (real but lower-severity/non-blocking), this one could silently show factually wrong research data to the user — judged worth fixing before close rather than deferring |

## Completed

| Item | Type | Completed | Result |
|------|------|-----------|--------|
| EPIC-1002: Unified Action Log | epic | 2026-08-31 | Merged via [PR #6](https://github.com/alekst23/webmcp-stock-screener/pull/6) (squash), closing #2. 5-agent review passed; 2 non-blocking follow-ups filed (T-1002-4, T-1002-5, Open). |
| EPIC-1003: Panel Action Set | epic | 2026-08-31 | Merged via [PR #7](https://github.com/alekst23/webmcp-stock-screener/pull/7) (squash), closing #3. 5-agent review passed; 2 non-blocking follow-ups filed (T-1003-3, T-1003-4, Open). |
| EPIC-1004: WebMCP Status Header | epic | 2026-08-31 | Merged via [PR #8](https://github.com/alekst23/webmcp-stock-screener/pull/8) (squash), closing #4. 5-agent review passed; 1 non-blocking follow-up filed (T-1004-2, Open) — 3 of 5 agents independently converged on the same finding (unhandled connect-failure rejection). |
| EPIC-1005: Workspace Snapshots | epic | 2026-08-31 | Merged via [PR #9](https://github.com/alekst23/webmcp-stock-screener/pull/9) (squash), closing #5. 5-agent review found one real bug (stale `focusedView` after snapshot load) — fixed directly on the branch before merge. 3 non-blocking follow-ups filed (T-1005-3, T-1005-4, T-1005-5, Open). |

_EPIC-1001 is still in progress — ticket-level completions (T-1001-1, 3, 4,
5, 6, 7) are tracked in `docs/plan/EPIC-1001/_epic.md`._

## Last Run

- **Date:** 2026-08-31
- **Actions taken:** Per explicit user instruction ("close all and merge to
  main") ran the full `/at-epic-close` pipeline (CI → merge-queue check →
  5-agent epic review → follow-up tickets → PR → merge) for all four of
  EPIC-1002 through EPIC-1005, back to back. User approved auto-merging each
  PR once CI/review passed, once, up front for the whole batch. Result: all
  four merged (PRs #6-#9), all four source issues (#2-#5) auto-closed, no
  open issues remain. Final `main` verified clean (typecheck 0 errors,
  59/59 tests, build succeeds) after all four landed.

  Two recurring problems surfaced and were handled each time: (1) each epic
  branch had forked from a stale pre-EPIC-1002 `main`, so before each one's
  CI/review pass it needed rebasing onto the then-current `main` tip,
  resolving real content conflicts (shared `spec.md` sections, `+page.svelte`
  wiring) by hand; (2) after each squash-merge, local `main` needed
  `git fetch && git reset --hard origin/main` to stay in sync (squash merges
  don't fast-forward against local linear history). EPIC-1005's review also
  caught one genuine functional bug (stale focus-detail view after a
  snapshot load could show the wrong chart data) — fixed directly on the
  branch rather than deferred.

  Earlier in the same run, a mis-launch (background agents sharing this
  session's working directory instead of isolated worktrees) was caught and
  corrected before any writes occurred — see the Decisions Log entry from
  the implementation phase.

  EPIC-1001 untouched throughout — still blocked on T-1001-2/T-1001-8.
- **Next suggested:** Re-check T-1001-2/T-1001-8 for human progress; once
  T-1001-8 is done, resume the T-1001-9 → T-1001-10 chain. The 9 follow-up
  tickets left across EPIC-1002/1003/1004/1005 (T-1002-4/5, T-1003-3/4,
  T-1004-2, T-1005-3/4/5) are all non-blocking and low priority relative to
  the 2026-09-03 deadline — pick up post-submission unless one becomes
  relevant to a judge-visible flow.
