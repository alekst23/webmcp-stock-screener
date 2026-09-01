# Project Plan

## Objective

Rebuild the app's WebMCP tool surface to match `.dev/design/tool-spec.md` — a
~33-core-tool (+13 follow-up) screener/research workbench covering context,
discovery, workspaces, panels, charts, screeners, results, similarity, an
agent-safety preview/apply layer, and persistence — replacing the current
11-tool pattern-research surface.

The 2026-09-03 hackathon submission is **no longer the driving constraint**
(user decision, 2026-09-01: "full spec, deadline is secondary"). EPIC-1001's
remaining tickets stay open but are no longer the critical path.

## Current Phase

Program build-out: EPIC-1006 through EPIC-1015 implement the new surface in
new files while the legacy surface keeps `main` deployable. EPIC-1015 cuts
over and retires the legacy surface last, gated on explicit user approval.

**Why this phase:** the user chose full replacement per spec over retrofitting
the existing tools. The spec's common contract (stable IDs,
`expected_revision`, `idempotency_key`, the mutation envelope, provenance) is
shared by every mutating tool, so EPIC-1006 is a hard foundation and the rest
fan out behind it.

## Active Work

| Item | Type | Status | Branch | Notes |
|------|------|--------|--------|-------|
| EPIC-1006: Workspace, revisions & common tool contract | epic | specced | `epic/EPIC-1006-…` merged to main | 8 tickets. Foundation: envelope, revisions, idempotency, undo, operation registry |
| EPIC-1007: Panel system | epic | specced | `epic/EPIC-1007-…` merged to main | 6 tickets. 5 tools; owns panel-kind registry |
| EPIC-1008: Discovery & catalog | epic | specced | `epic/EPIC-1008-…` merged to main | 7 tickets. 3 read-only tools; owns catalog registry + live-data ports |
| EPIC-1009: Screener core | epic | specced | `epic/EPIC-1009-…` merged to main | 10 tickets. 6 tools; 8 filter-condition types |
| EPIC-1010: Results & explain | epic | specced | `epic/EPIC-1010-…` merged to main | 8 tickets. 4 tools; no-silent-rerun guarantee |
| EPIC-1011: Chart tools | epic | specced | `epic/EPIC-1011-…` merged to main | 9 tickets. 5 tools; owns captured-setup contract |
| EPIC-1012: Similarity search | epic | specced | `epic/EPIC-1012-…` merged to main | 8 tickets. 3 tools |
| EPIC-1013: Safety layer (preview & apply) | epic | specced | `epic/EPIC-1013-…` merged to main | 6 tickets. 2 tools; atomic apply over the operation registry |
| EPIC-1014: High-value follow-up tools | epic | specced | `epic/EPIC-1014-…` merged to main | 11 tickets. backtest, watchlists, alerts, computed fields, export |
| EPIC-1015: Legacy surface cutover | epic | specced | `epic/EPIC-1015-…` merged to main | 8 tickets. Gated on user approval; runs last |
| EPIC-1001: WebMCP Pattern Research Workbench | epic | paused | `epic/EPIC-1001-pattern-research-workbench` | 8/10 tickets done; T-1001-2 blocked, T-1001-9/10 deprioritized |

## Implementation wave order

Dependencies only — everything within a wave runs in parallel.

| Wave | Epics | Why sequenced here |
|------|-------|--------------------|
| W1 | EPIC-1006, EPIC-1008 | Independent foundations. 1006 owns the mutation contract; 1008 is read-only so it needs nothing from 1006. |
| W2 | EPIC-1007, EPIC-1009, EPIC-1011, EPIC-1013 | All consume 1006's contract; mutually independent. |
| W3 | EPIC-1010, EPIC-1012 | 1010 needs `run_id` from 1009; 1012 needs `capture_chart_setup` from 1011. |
| W4 | EPIC-1014, then EPIC-1015 | 1014 builds on all core epics. 1015 cutover is last and user-gated. |

## Backlog

1. **Review the Wave 0 ticket breakdown** once all ten epic-creation agents
   report, then launch implementation Wave 1 (EPIC-1006, EPIC-1008).
2. Launch Waves 2-4 as their dependencies land.
3. **EPIC-1015 cutover** — do not launch until the user confirms the new
   surface is good. It retires the currently-deployed submission's tools.
4. (Deprioritized) EPIC-1001's remaining tickets: T-1001-2 (live verification,
   needs a human), T-1001-9 (real data), T-1001-10 (submission package).
5. (Low priority) The 9 follow-up tickets left by EPIC-1002/1003/1004/1005 —
   T-1002-4/5, T-1003-3/4, T-1004-2, T-1005-3/4/5.

## Blockers

| Blocker | Affects | Since | Action needed |
|---------|---------|-------|----------------|
| Live reference/fundamental market data (sectors, industries, indexes, exchanges, countries, fundamentals, earnings calendars) is being set up in a separate thread | EPIC-1008, EPIC-1009, EPIC-1014 | 2026-09-01 | Epics define domain ports and code against them; the parallel workstream supplies the implementation. Not blocking epic work — only end-to-end verification. |
| `render.yaml:47` health-checks `/api/spike/ping`, a route EPIC-1015 plans to retire | EPIC-1015 | 2026-09-01 | Repoint the health check before deleting the spike stack, or the Render backend deploy fails. Verified against `backend/api/routes/spike.py:24`. |
| `measure` and `splitInstances` have no equivalent in the spec's core tool list | EPIC-1015 | 2026-09-01 | User sign-off needed at T-1015-2 on whether these are deliberate capability drops. Nearest equivalent is follow-up `backtest_screener`. |
| Multi-step temporal setup matching may be only partially covered by the new filter tree | EPIC-1015 | 2026-09-01 | User sign-off needed at T-1015-2 on partial parity. |
| T-1001-2 unverified | T-1001-2 | 2026-08-30 | Human + real WebMCP browser + real AI agent must complete `T-1001-2-live-verification-runbook.md`. Deprioritized. |
| EODHD paid tier / R2/S3 bucket | T-1001-9 | 2026-08-31 | Deprioritized along with T-1001-9. |

## Cross-epic reconciliations pending

_Surfaced by Wave 0. Each needs one decision before the owning epic is
implemented; none can be settled by a single epic alone._

| # | Question | Raised by | Owner | Working assumption |
|---|----------|-----------|-------|--------------------|
| 1 | Is `expected_revision` optional-and-warn, or required-and-reject, on mutations touching existing resources? | EPIC-1006 | EPIC-1006 | Optional, warns. Weakens the concurrency guarantee — recommend required-and-reject. |
| 2 | Must operation-registry handlers be pure `(state, op) → {state, affectedIds, warnings}`? | EPIC-1013 | EPIC-1006 | Not yet specified. EPIC-1013 needs purity or it falls back to defensive cloning; cheap now, expensive to retrofit. |
| 3 | Pinned-run retention/expiry policy | EPIC-1009 + EPIC-1010 | EPIC-1009 | Eviction is an explicit error, TTL unset. Both epics flagged it; needs one number. |
| 4 | Who owns the OHLCV bars port — discovery or charts? | EPIC-1011 | EPIC-1008 | A narrow port in EPIC-1011, aliasable to EPIC-1008's later. |

_Resolved during Wave 0: `explain_result`'s contribution data (EPIC-1009
stores per-node evaluated value + pass/fail per match, so explain is a
lookup); wire casing (snake_case wire / camelCase internals, EPIC-1006
authoritative)._

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
| 2026-09-01 | R2 bucket blocker closed — credentials (`R2_BUCKET_NAME`, `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_TOKEN_VALUE`) are present in the gitignored root `.env` | User created the bucket between runs; the panel object store T-1001-9 depends on is ready |
| 2026-09-01 | Built T-1001-9's full pipeline against fixtures rather than waiting for the API key, deferring only the live backfill run and the AC5 spot-check | The key's absence blocks one command, not the code; with the 2026-09-03 deadline there was no reason to leave the implementation idle while waiting for a paste |
| 2026-08-31 | Dropped the Render persistent disk from `render.yaml`/T-1001-8's mock deploy; T-1001-9's real panel data will persist in object storage (R2/S3) instead of a Render disk | Discovered live during T-1001-8 deployment that Render's free tier doesn't support disks at all, and the paid tier needed for one (~$25/mo) costs far more than R2/S3 object storage for this data volume (~60-90MB); the mock panel regenerates deterministically on every deploy instead, at zero functional cost. Considered a full AWS re-platform instead but rejected given the 2026-09-03 deadline — real migration work for marginal savings over the object-storage fix, which keeps the already-working Render pipeline intact |
| 2026-09-01 | Objective changed: implement `.dev/design/tool-spec.md` as a **full replacement** of the 11-tool pattern surface, with the 2026-09-03 hackathon deadline explicitly secondary | User chose "Full replacement per spec" + "Full spec, deadline is secondary" when presented with the scope options and the concern that 33 tools are not buildable to quality in two days |
| 2026-09-01 | New surface is built **alongside** the legacy one in new files; a final user-gated epic (EPIC-1015) retires the legacy tools/UI | User chose "Build new alongside, retire at the end" — keeps `main` deployable throughout and keeps the deployed hackathon submission working while the replacement is under construction |
| 2026-09-01 | Reference/fundamental market data is sourced from a **separate parallel workstream**, not a mock pipeline built here; epics define domain ports and code against them | User: "Live data is being set up in another thread." Avoids duplicating that effort and avoids blocking the screener epics on the EODHD paid-tier upgrade |
| 2026-09-01 | Behavioral specs derived from `.dev/design/tool-spec.md` instead of running ten `/at-epic-design` intent interviews | The doc is already a detailed design artifact the user wrote; its two genuine gaps (screener data source, legacy migration) were resolved by direct question. Epics record any remaining gap as an explicit "Open question" rather than guessing |
| 2026-09-01 | EPIC-1006 owns the spec's common contract (stable IDs, `expected_revision`, `idempotency_key`, mutation envelope, provenance type, extensible operation registry) as shared infrastructure the other nine epics import | The contract is shared by every mutating tool; letting six epics each invent their own envelope would make consolidation a wreck. Makes 1006 the one genuine hard dependency in the program |
| 2026-09-01 | Wave 0 (epic creation) run as ten parallel worktree agents with **pinned** epic numbers | Concurrent `/at-epic-new` runs would each auto-assign the same next number and collide |

## Completed

| Item | Type | Completed | Result |
|------|------|-----------|--------|
| EPIC-1002: Unified Action Log | epic | 2026-08-31 | Merged via [PR #6](https://github.com/alekst23/webmcp-stock-screener/pull/6) (squash), closing #2. 5-agent review passed; 2 non-blocking follow-ups filed (T-1002-4, T-1002-5, Open). |
| EPIC-1003: Panel Action Set | epic | 2026-08-31 | Merged via [PR #7](https://github.com/alekst23/webmcp-stock-screener/pull/7) (squash), closing #3. 5-agent review passed; 2 non-blocking follow-ups filed (T-1003-3, T-1003-4, Open). |
| EPIC-1004: WebMCP Status Header | epic | 2026-08-31 | Merged via [PR #8](https://github.com/alekst23/webmcp-stock-screener/pull/8) (squash), closing #4. 5-agent review passed; 1 non-blocking follow-up filed (T-1004-2, Open) — 3 of 5 agents independently converged on the same finding (unhandled connect-failure rejection). |
| EPIC-1005: Workspace Snapshots | epic | 2026-08-31 | Merged via [PR #9](https://github.com/alekst23/webmcp-stock-screener/pull/9) (squash), closing #5. 5-agent review found one real bug (stale `focusedView` after snapshot load) — fixed directly on the branch before merge. 3 non-blocking follow-ups filed (T-1005-3, T-1005-4, T-1005-5, Open). |
| T-1001-8: Deploy & ops (mock) | ticket | 2026-08-31 | Backend live on Render, frontend live on Cloudflare Workers. All 5 ACs verified (HTTPS, mock data, CORS, rate limiting, real product endpoint working end-to-end). See `docs/reference/deployment.md`. Live during deployment: Render disk isn't supported on free tier (dropped it); Cloudflare's current onboarding needed `wrangler.jsonc` instead of classic Pages config. Unblocks T-1001-9. |

| UI/WebMCP hotfixes (#10, #11, #12 + bridge follow-up) | hotfix | 2026-08-31/09-01 | Four hotfixes landed on `main` after the last plan update, all judge-visible-surface fixes: always show the tool count in the header (#10), workbench UI refactor — visible tool list, log moved to the bottom, compact snapshots (#11), report whether WebMCP tools are actually callable rather than merely present (#12), and `7e6f4a6`, which installs a page-owned WebMCP bridge instead of trying to predict browser support. |
| #10 always-visible tool count | fix | 2026-08-31 | Merged (PR #10). Header shows the tool count unconditionally. |
| #11 workbench UI refactor | fix | 2026-09-01 | Merged (PR #11). Visible tool list, log moved to bottom, compact snapshots. |
| #12 bridge status accuracy | fix | 2026-09-01 | Merged (PR #12). Status reports whether WebMCP tools are actually callable, not whether the browser claims support. |
| Page-owned WebMCP bridge | fix | 2026-09-01 | Commit `7e6f4a6`. The page installs its own bridge instead of predicting browser support, so the advertised tool surface is always the callable one. Typecheck clean, 112/112 tests pass. |

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
