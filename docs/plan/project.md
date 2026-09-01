# Project Plan

## Objective

Rebuild the app's WebMCP tool surface to match `docs/reference/tool-spec.md` — a
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
| EPIC-1006: Workspace, revisions & common tool contract | epic | specced | `epic/EPIC-1006-…` merged to main | 8 tickets. Foundation: envelope, revisions, idempotency, undo, operation registry; owns `get_canvas_state` (renamed from `get_workspace`) |
| EPIC-1007: Panel system | epic | specced | `epic/EPIC-1007-…` merged to main | 7 tickets. 14 tools; owns panel-kind registry and source/renderer contract registry |
| EPIC-1008: Discovery & catalog | epic | **implemented, unmerged** | `epic/EPIC-1008-discovery-and-catalog` (4 commits ahead of main) | All 7 tickets landed 2026-09-01. Frontend 224 tests pass (was 117), svelte-check 0 errors, backend 60/5. All new files; no existing source touched. Not wired into the live page — composition root unowned. Awaiting `/at-epic-close`. |
| EPIC-1009: Screener core | epic | specced | `epic/EPIC-1009-…` merged to main | 10 tickets. 6 tools; 8 filter-condition types |
| EPIC-1010: Results & explain | epic | specced | `epic/EPIC-1010-…` merged to main | 8 tickets. 2 tools + table-renderer contract registered into EPIC-1007; no-silent-rerun guarantee |
| EPIC-1011: Chart tools | epic | specced | `epic/EPIC-1011-…` merged to main | 9 tickets. 3 tools + chart-renderer contract registered into EPIC-1007; owns captured-setup contract |
| EPIC-1012: Similarity search | epic | specced | `epic/EPIC-1012-…` merged to main | 8 tickets. 3 tools |
| EPIC-1013: Safety layer (preview & apply) | epic | specced | `epic/EPIC-1013-…` merged to main | 6 tickets. 2 tools; atomic apply over the operation registry |
| EPIC-1014: High-value follow-up tools | epic | specced | `epic/EPIC-1014-…` merged to main | 11 tickets. backtest, watchlists, alerts, computed fields, export |
| EPIC-1015: Legacy surface cutover | epic | specced | `epic/EPIC-1015-…` merged to main | 8 tickets. Gated on user approval; runs last |
| EPIC-1001: WebMCP Pattern Research Workbench | epic | paused | `epic/EPIC-1001-pattern-research-workbench` | 8/10 tickets done. T-1001-2 blocked (needs human + real WebMCP browser). T-1001-10 superseded by #14. **T-1001-9 is implemented, CI-green, and UNMERGED** on `feat/T-1001-9-real-data-pipeline` (`8448059`): EODHD backfill + nightly delta CLIs, R2 object store, universe metadata, `GET /api/research/panel`, and the compact `PanelFrame` (141 -> 25.1 B/row) EPIC-1016 builds on. ACs 1-4 done against recorded shapes; AC5 live run gated on EPIC-1016's T-1016-1/T-1016-2. |
| EPIC-1016: Market data storage | epic | **4/5 implemented, unmerged** | `epic/EPIC-1016-market-data-storage` (rebased onto main, 7 commits) | T-1016-1/2/3/5 landed 2026-09-01; T-1016-6 partial (blocked, needs paid backfill + deployed instance). Backend 99 tests pass (was 60). Measured: bulk load 63 B/row (was 1,560); nightly append ~0 MB on a 1.2M-row panel (was 1,980 MB); one-ticker read touches 0.9% of a 3M-row panel. **The 512 MB target does not hold at the stated universe** — see Blockers. Triaged from #13 (panel load peaks ~13 GB — backend cannot boot on real data at any tier). **POC scope**: trimmed liquid universe (~2,000 tickers x 10+y, ~5M rows, ~130 MB) fully resident on 512 MB; removes cost that grows faster than the data, but does NOT decouple memory from dataset size. Streaming (T-1016-4) deferred — DuckDB-over-R2 is the designated next rung. Blocks T-1001-9's AC1 backfill and AC5 spot-check. |

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
   needs a human) and T-1001-9 (real data — implemented and CI-green on
   `feat/T-1001-9-real-data-pipeline`, unmerged; its AC1/AC5 live run is
   gated on EPIC-1016's T-1016-1/T-1016-2). T-1001-10 is superseded by #14.
5. (Low priority) The 9 follow-up tickets left by EPIC-1002/1003/1004/1005 —
   T-1002-4/5, T-1003-3/4, T-1004-2, T-1005-3/4/5.

## Blockers

| Blocker | Affects | Since | Action needed |
|---------|---------|-------|----------------|
| Reference/fundamental data (industries, indexes, countries, fundamentals, earnings calendars) has **no owner** | EPIC-1008, EPIC-1009, EPIC-1014 | 2026-09-01 | Was recorded as supplied by a "separate parallel workstream". User confirms no such work is defined — the quote behind it ("live data is being set up in another thread") meant T-1001-9 in this repo, not a separate human workstream. T-1001-9 supplies OHLCV plus sector and market cap (Nasdaq screener CSV) and nothing else on that list. Decide per data class: source it, drop the dependent capability, or have the port report it unavailable. Ports are already written, so this blocks end-to-end behavior, not epic work. |
| `render.yaml:47` health-checks `/api/spike/ping`, a route EPIC-1015 plans to retire | EPIC-1015 | 2026-09-01 | Repoint the health check before deleting the spike stack, or the Render backend deploy fails. Verified against `backend/api/routes/spike.py:24`. |
| `measure` and `splitInstances` have no equivalent in the spec's core tool list | EPIC-1015 | 2026-09-01 | User sign-off needed at T-1015-2 on whether these are deliberate capability drops. Nearest equivalent is follow-up `backtest_screener`. |
| Multi-step temporal setup matching may be only partially covered by the new filter tree | EPIC-1015 | 2026-09-01 | User sign-off needed at T-1015-2 on partial parity. |
| T-1001-2 unverified | T-1001-2 | 2026-08-30 | Human + real WebMCP browser + real AI agent must complete `T-1001-2-live-verification-runbook.md`. Deprioritized. |
| EPIC-1016 measured 688 MB peak at the epic's own target universe — 34% over the 512 MB budget | EPIC-1016 T-1016-6, T-1001-9 AC1/AC5 | 2026-09-01 | The ~13 GB load peak is gone, but a whole-universe search still widens to float64 panel-wide in `backend/infra/expression.py` (~121 B/row). Resident panel is 131 MB as predicted; the search is what overruns. Two options recorded in T-1016-6: trim the universe to ~1,000 names x 10y (measured 383 MB, fits today) or take the DuckDB-over-R2 rung early. **Needs a user decision.** Measured this session (synthetic panels, pessimistic "broad" pattern, `scripts/measure_universe_scale.py`): 2,000x10y = 5.04M rows -> 688 MB (fails); 1,500x7y = 2.65M rows -> 437 MB; 2,000x5y = 2.52M rows -> 385 MB; 1,000x10y = 2.52M rows -> 383 MB. Cost is ~linear in rows: peak ~= 83 MB fixed + ~120 B/row, so the budget is ~2.6M rows however it is sliced. Note the driver is `expression.py`'s float64 widening, not the panel -- fixing that buys roughly 2x headroom without cutting the dataset at all. |
| `docs/design/` was not updated in the 2026-09-01 spec reconciliation | EPIC-1006, EPIC-1007, EPIC-1010, EPIC-1011 | 2026-09-01 | `docs/plan/` was reconciled thoroughly against the revised tool spec; the design docs those tickets cite as their authority were not. `docs/design/panel-system/technical.md:115` still says "Five `ToolSpec`s (`add_panel`, `update_panel`, ...)" against the ticket's fourteen; `spec.md:150` still treats visibility as `update_panel`'s job; `docs/design/workspace-revisions/` still names `get_workspace`; `docs/design/screener-core/technical.md:6` and `docs/design/discovery-and-catalog/technical.md:7,239` still name `select_result` and `edit_chart_studies`. An implementing agent reads both and gets contradictory instructions. T-1007-7 already anticipates this and instructs treating the design docs as silent, but that is a workaround, not a fix. |
| `save_workspace_template` is in the revised tool spec but owned by no epic | EPIC-1006 or EPIC-1007 | 2026-09-01 | The revision added a Persistence row, `save_workspace_template` ("Save a reusable layout and panel configuration"), that the reconciliation pass did not assign. EPIC-1007's `apply_layout_template` consumes templates that nothing in the program creates. Assign it (EPIC-1006 owns Persistence; EPIC-1007 owns layout) or drop it from the spec. |
| Panel load path peaks ~13 GB (issue #13) | T-1001-9 AC1/AC5, EPIC-1016 | 2026-09-01 | Real blocker for real data. EODHD paid tier and R2 are NO LONGER blockers: key verified live 2026-09-01 (`dailyRateLimit` 100000, arbitrary tickers, 2,680 rows for NVDA over 10y) and R2 credentials are in the gitignored root `.env`. Land EPIC-1016's T-1016-1/T-1016-2 before attempting the backfill. |
| EPIC-1016 (market data storage, still being triaged) rearchitects the same OHLCV panel that EPIC-1008/EPIC-1011 read from — overlaps cross-epic reconciliation #4 below (bars-port ownership) | EPIC-1008, EPIC-1011, EPIC-1016 | 2026-09-01 | Once EPIC-1016 lands a spec, reconcile its storage interface against EPIC-1008's/EPIC-1011's port assumptions before Wave 1 (EPIC-1008) implements against a port that EPIC-1016 might reshape. |

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
| 2026-09-01 | Revised `docs/reference/tool-spec.md`'s panel tool table (user-supplied) and reconciled EPIC-1006/1007/1008/1010/1011/1012/1014 against it | The revision establishes panel source (screener/watchlist/symbol-list/panel reference) and renderer (table/chart_grid/heatmap/scatter) as independent axes an agent sets separately (`bind_panel_source`, `set_panel_renderer`) — "screeners produce datasets; panels decide how those datasets are visualized." Reconciled by: renaming `get_workspace` to `get_canvas_state` (EPIC-1006, unchanged owner); expanding EPIC-1007 from 5 to 14 panel tools and 6 to 7 tickets, adding new ticket T-1007-7 (source/renderer contract registry) and new tools `duplicate_panel`, `apply_layout_template`, `split_panel`, `maximize_panel`, `bind_panel_source`, `set_panel_renderer`, `configure_chart_grid`, `unlink_panels`; retiring EPIC-1010's `configure_results_table`/`select_result` and EPIC-1011's `configure_chart`/`edit_chart_studies` as standalone tools in favor of those epics registering table-renderer and chart-renderer *contracts* into EPIC-1007's new registry, reached through EPIC-1007's generic `configure_panel_view`/`set_panel_selection`/`bind_panel_source` tools. Left open in EPIC-1007: whether the tool-spec's `"kind": "collection"` example needs a new panel kind or reuses `chart` with a `chart_grid` renderer (assumed the latter). Also left open, not resolved this pass: where panel title/visibility/collapsed-state — previously `update_panel`'s job — now lives; folded provisionally into `configure_panel_view` pending user confirmation. No code exists yet for any of these epics, so this was a docs-only reconciliation. |
| 2026-09-01 | T-1001-10 moved out of EPIC-1001 to issue #14 | Its ACs required filing before the 2026-09-03 deadline, which is no longer the objective, so the ticket could never be honestly closed as written. It also sat Open marked `Depends on: T-1001-9`, making EPIC-1001 look incomplete for a reason that no longer applies. Deliverables carry over; the real-data requirement now runs through EPIC-1016's T-1016-6. |
| 2026-09-01 | EPIC-1016 retargeted to POC scope; T-1016-4 (chunked streaming) deferred | User set the goal as a decent POC with a real DB understood as the production answer. Given that, a hand-rolled chunked scanner is a query engine built to be discarded when it starts mattering — it buys no latency (findInstances scans the whole universe by design), only headroom, which DuckDB-over-R2 gives for free off the same partitioned Parquet. Upgrade ladder recorded in technical.md. |
| 2026-09-01 | Panel universe trimmed by a liquidity/market-cap floor rather than taking all ~6,268 listed names | Product decision as much as sizing: thinly-traded microcaps distort pattern base rates. T-1016-6 fixes and records the cut. |
| 2026-09-01 | Filed #13 and triaged it as EPIC-1016 rather than patching `panel_io.py` in place | Fixing only the I/O boundary leaves residency linear in universe x history; panel size is a product input, so the ceiling would return. User chose the full-universe-on-free-tier target, which makes streaming in-scope. |
| 2026-09-01 | EPIC-1016 numbered off-rule (derivation gives EPIC-1013, taken by Wave 0's Safety layer) | Using the derived number would have collided with unrelated specced work. Deviation recorded in the epic file. |
| 2026-09-01 | Feature slug `market-data-storage`, not `panel-system` | `panel-system` already owns the agent-driven UI panel container — an unrelated concept sharing the word 'panel'. |
| 2026-09-01 | Panel degradation is serve-and-disclose, not fail-closed | User decision. A failed nightly cron shouldn't take the app down, but stale or partial data must never read as current and complete. |
| 2026-09-01 | Hardened `at-project-go`, `at-epic-new`, `at-epic-run` (global skills, not project-specific) after this session's Step-6 cleanup deleted a live worktree belonging to a different, concurrently-running session | The user asked "did you destroy any work on main?" — investigation found no `main` damage, but found the actual cause: cleanup deleted-by-glob-pattern instead of by provenance. Fixed: a run manifest scopes cleanup to only what the current run launched; `git worktree remove` no longer forces past uncommitted changes; epic numbering can be caller-pinned to avoid concurrent-scan collisions; agents in a fan-out no longer edit shared index files. See `~/.claude/skills/{at-project-go,at-epic-new,at-epic-run}/SKILL.md`. |
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
| 2026-09-01 | Objective changed: implement `docs/reference/tool-spec.md` as a **full replacement** of the 11-tool pattern surface, with the 2026-09-03 hackathon deadline explicitly secondary | User chose "Full replacement per spec" + "Full spec, deadline is secondary" when presented with the scope options and the concern that 33 tools are not buildable to quality in two days |
| 2026-09-01 | New surface is built **alongside** the legacy one in new files; a final user-gated epic (EPIC-1015) retires the legacy tools/UI | User chose "Build new alongside, retire at the end" — keeps `main` deployable throughout and keeps the deployed hackathon submission working while the replacement is under construction |
| 2026-09-01 | ~~Reference/fundamental market data is sourced from a separate parallel workstream~~ — **retracted 2026-09-01** | Rested on reading "live data is being set up in another thread" as a separate human workstream. It meant T-1001-9, in this repo. User confirms no such work is defined. The reference-data dependency for EPIC-1008/1009/1014 is unowned; see Blockers. Left visible rather than deleted so the same inference is not made again from the same quote. |
| 2026-09-01 | Behavioral specs derived from `docs/reference/tool-spec.md` instead of running ten `/at-epic-design` intent interviews | The doc is already a detailed design artifact the user wrote; its two genuine gaps (screener data source, legacy migration) were resolved by direct question. Epics record any remaining gap as an explicit "Open question" rather than guessing |
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

## Last Run (2026-09-01, session closed via /at-project-sleep)

- **Trigger:** User asked to implement `docs/reference/tool-spec.md`
  (formerly `.dev/design/tool-spec.md`), then explicitly closed the session
  ("let's save this for next run").
- **Shipped:** Nothing to production — this session was planning-only.
  Landed on `main`: the page-owned WebMCP bridge fallback (`7e6f4a6`, PRs
  #10-#12 also backfilled into the plan); the objective rewrite to the
  tool-spec full-replacement program; ten epics (EPIC-1006 through
  EPIC-1015, 81 tickets total) specced and merged; the tool spec moved from
  gitignored `.dev/` to tracked `docs/reference/tool-spec.md` with 73
  references repointed; three global skills
  (`at-project-go`/`at-epic-new`/`at-epic-run`) hardened against the
  worktree-deletion bug this session surfaced.
- **Scaffolded, not launched:** All 81 tickets across EPIC-1006-1015 are
  planned but zero implementation code has been written. Wave 1
  (EPIC-1006 + EPIC-1008, 15 tickets) is ready to launch on command.
  EPIC-1015 (legacy cutover) stays gated on explicit user approval and two
  open capability-drop sign-offs (`measure`/`splitInstances`, partial
  temporal-pattern parity).
- **Filed:** Issue #13 (bug: panel load path materializes as Pydantic
  objects, 13GB peak memory) — filed outside this session.
- **Deferred:** Four cross-epic reconciliations need one decision each
  before Wave 1 (see "Cross-epic reconciliations pending" above):
  `expected_revision` strictness, operation-handler purity, pinned-run
  retention, OHLCV-bars-port ownership. Two EPIC-1015 capability-drop
  sign-offs. EPIC-1001's remaining tickets (T-1001-2/9/10) stay
  deprioritized but open.
- **In-flight at close:** A *different, concurrently-running session* is
  triaging issue #13 into EPIC-1016 (market data storage) — worktree
  `.worktrees/triage-13` on branch `epic/EPIC-1016-market-data-storage`,
  one uncommitted file (`docs/design/market-data-storage/spec.md`), not
  reviewed or touched by this session. Do not clean up that worktree or
  branch; it is not this session's to manage.
- **Next session should:** Check whether EPIC-1016's triage has landed
  (`git log epic/EPIC-1016-market-data-storage`, `git worktree list`) before
  doing anything else, since it overlaps EPIC-1008/EPIC-1011's OHLCV-bars
  port ownership question. If clear, resolve the four cross-epic
  reconciliations (recommend: required-and-reject for `expected_revision`,
  pure handlers required), then launch Wave 1 (`/at-epic-run EPIC-1006` and
  `/at-epic-run EPIC-1008` in parallel). Do not launch EPIC-1015 without
  explicit user sign-off on its two capability drops.

## Last Run (2026-09-01, session closed via /at-project-sleep)

- **Trigger:** `/at-project-go T-1001-9`, then user redirect. User note at
  close: *"outline the next steps so we can resume next time"*.
- **Shipped:** Nothing merged to an epic or to origin. Five plan/doc commits
  on local `main` (`ea7ed84`, `8a8d1cb`, `413faff`, `582004b` + this one).
- **Scaffolded, not launched:** EPIC-1016 (5 tickets scheduled + 1 deferred)
  on `epic/EPIC-1016-market-data-storage` (`13afd89`, `fc73984`). T-1001-9's
  implementation on `feat/T-1001-9-real-data-pipeline` (`8448059`).
- **Filed:** #13 (panel load path, triaged -> EPIC-1016), #14 (POC packaging,
  supersedes T-1001-10, untriaged).
- **Deferred:** T-1016-4 (chunked streaming) — DuckDB-over-R2 is the
  designated next rung instead.
- **In-flight at close:** Nothing running. No worktrees. Another session has
  been writing this repo concurrently — see Blockers.
- **Next session should:** Merge `feat/T-1001-9-real-data-pipeline` first; it
  is done, CI-green, and EPIC-1016 declares a hard dependency on it, so
  leaving it unmerged makes 1016 stack on a branch. Then run EPIC-1016's
  T-1016-1 and T-1016-2 — those two alone remove the ~13 GB load peak and
  make a real backfill physically possible. A real backfill of a trimmed
  liquid universe comes immediately after, which is when live data actually
  arrives; the rest of EPIC-1016 (T-1016-3/5/6) hardens it. Verify before
  starting that `main` has not moved again and that the EODHD key is still in
  `backend/.env` (it is gitignored and was absent at the start of this
  session despite the account being upgraded).

### Verified live this session (2026-09-01)

Facts established by real API calls, superseding `data-provider.md` estimates:

- EODHD paid tier active: `dailyRateLimit` 100000, arbitrary tickers allowed,
  NVDA 2016-2026 returned 2,680 rows in one call.
- Bulk-by-exchange delta endpoint needs **no pagination** — one call returned
  all 44,557 US rows for a single date. Closes a `data-provider.md` open item.
  Its row shape differs from the per-ticker shape (adds `code`,
  `exchange_short_name`).
- Real listed universe is **6,268 tickers** (NASDAQ 3,690 + NYSE 2,321 +
  AMEX 257), not the ~4,200 estimated. Filtering `Type == 'Common Stock'`
  over all US symbols gives 17,992, but most are OTC.
- Measured memory costs: `list[PriceBar]` 1,081 B/row; `(ticker,date)` index
  dict 118 B/row; compact `PanelFrame` 25.1 B/row.
