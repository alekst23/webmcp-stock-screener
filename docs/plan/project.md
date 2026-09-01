# Project Plan

## Objective

Rebuild the app's WebMCP tool surface to match `docs/reference/tool-spec.md` — a
~33-core-tool (+13 follow-up) screener/research workbench covering context,
discovery, workspaces, panels, charts, screeners, results, similarity, an
agent-safety preview/apply layer, and persistence — replacing the current
11-tool pattern-research surface.

The 2026-09-03 hackathon submission is **no longer the driving constraint**
(user decision, 2026-09-01: "full spec, deadline is secondary"). EPIC-0001's
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
| EPIC-1006: Workspace, revisions & common tool contract | epic | **in progress (`/at-epic-run`, this session)** | `epic/EPIC-1006-…` (per-ticket worktrees for T-1006-1/2/3, Wave 1) | 8 tickets, zero code as of launch. Foundation: envelope, revisions, idempotency, undo, operation registry; owns `get_canvas_state` (renamed from `get_workspace`). Reconciliations #1/#2 resolved by working assumption. Mid-run, flagged it to reuse EPIC-1008's `src/lib/surface/ids.ts`/`provenance.ts` rather than building a second stable-ID/provenance scheme — see Decisions Log. |
| EPIC-1007: Panel system | epic | specced | `epic/EPIC-1007-…` merged to main | 7 tickets. 14 tools; owns panel-kind registry and source/renderer contract registry |
| EPIC-1008: Discovery & catalog | epic | **PR open** ([#18](https://github.com/alekst23/webmcp-stock-screener/pull/18)) | `epic/EPIC-1008-discovery-and-catalog`, pushed | 7/8 tickets Done; T-1008-8 filed as a non-blocking follow-up (fragile string-matched unavailable-source detection). CI passed (224 frontend tests, was 117; 60 backend; typecheck/black/isort/flake8 clean). 5-agent epic review passed after triage, no blocking findings. New `docs/architecture/` tree created, documenting the program-wide composition model. Not wired into the live page — composition root still unowned across the whole program, not an EPIC-1008 gap; see Blockers. Reconciliation #4 (OHLCV bars port) resolved by working assumption to unblock this close. Awaiting merge. |
| EPIC-1009: Screener core | epic | specced | `epic/EPIC-1009-…` merged to main | 10 tickets. 6 tools; 8 filter-condition types |
| EPIC-1010: Results & explain | epic | specced | `epic/EPIC-1010-…` merged to main | 8 tickets. 2 tools + table-renderer contract registered into EPIC-1007; no-silent-rerun guarantee |
| EPIC-1011: Chart tools | epic | specced | `epic/EPIC-1011-…` merged to main | 9 tickets. 3 tools + chart-renderer contract registered into EPIC-1007; owns captured-setup contract |
| EPIC-1012: Similarity search | epic | specced | `epic/EPIC-1012-…` merged to main | 8 tickets. 3 tools |
| EPIC-1013: Safety layer (preview & apply) | epic | specced | `epic/EPIC-1013-…` merged to main | 6 tickets. 2 tools; atomic apply over the operation registry |
| EPIC-1014: High-value follow-up tools | epic | specced | `epic/EPIC-1014-…` merged to main | 11 tickets. backtest, watchlists, alerts, computed fields, export |
| EPIC-1015: Legacy surface cutover | epic | specced | `epic/EPIC-1015-…` merged to main | 8 tickets. Gated on user approval; runs last |
| EPIC-0001: WebMCP Pattern Research Workbench | epic | paused | `epic/EPIC-0001-pattern-research-workbench` | 8/10 tickets done. T-0001-2 blocked (needs human + real WebMCP browser). T-0001-10 superseded by #14. **T-0001-9 is implemented, CI-green, and UNMERGED** on `feat/T-0001-9-real-data-pipeline` (`8448059`): EODHD backfill + nightly delta CLIs, R2 object store, universe metadata, `GET /api/research/panel`, and the compact `PanelFrame` (141 -> 25.1 B/row) EPIC-0013 builds on. ACs 1-4 done against recorded shapes; AC5 live run gated on EPIC-0013's T-0013-1/T-0013-2. |
| EPIC-0013: Market data storage | epic | **merged to main** (`08cc403`, local merge, no PR/gh record) | `epic/EPIC-0013-market-data-storage` | T-0013-1/2/3/5 landed and now on `main`; T-0013-6 still partial (blocked, needs paid backfill + deployed instance). Backend 99 tests pass (was 60). Measured: bulk load 63 B/row (was 1,560); nightly append ~0 MB on a 1.2M-row panel (was 1,980 MB); one-ticker read touches 0.9% of a 3M-row panel. Issue #13 is still **open** on GitHub despite the merge — no PR flow ran to auto-close it; needs manual close or a follow-up ticket-close pass. Reconciliation with EPIC-1008/EPIC-1011's OHLCV-bars port assumptions (Blockers table) is now live, not hypothetical, since real merged code exists to reconcile against. |
| EPIC-0016: AWS re-platform | epic | **in progress** | `epic/EPIC-0016-aws-replatform` | Now **12** tickets (T-0016-12 added). Spec + all decisions settled. **Landed and merged to the epic branch:** T-0016-2 (health), T-0016-3 (object store on the credential chain), T-0016-4 (Terraform foundation — 17 resources APPLIED LIVE, clean second plan), T-0016-5 (EODHD key in SSM SecureString), T-0016-12 (`REQUIRE_REAL_PANEL` guard + render.yaml rename fix). Backend 123 tests pass (was 99). T-0016-1 (Dockerfile) written but **build-unverified** — host disk exhaustion. T-0016-7 retargeted to backfill-into-S3 and running. T-0016-6/8/9/10 not started; T-0016-11 user-gated. |

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
4. (Deprioritized) EPIC-0001's remaining tickets: T-0001-2 (live verification,
   needs a human) and T-0001-9 (real data — implemented and CI-green on
   `feat/T-0001-9-real-data-pipeline`, unmerged; its AC1/AC5 live run is
   gated on EPIC-0013's T-0013-1/T-0013-2). T-0001-10 is superseded by #14.
5. (Low priority) The 9 follow-up tickets left by EPIC-0002/1003/1004/1005 —
   T-0002-4/5, T-0003-3/4, T-0004-2, T-0005-3/4/5.

## Blockers

| Blocker | Affects | Since | Action needed |
|---------|---------|-------|----------------|
| Host disk exhaustion: 460 GB volume repeatedly under 1 GB free | EPIC-0016 T-0016-1/T-0016-6, and every other session on this machine | 2026-09-01 | Docker's own containerd metadata is **corrupted** by I/O errors from running out of space (`docker system prune` fails reading its own blob/snapshot store), so the 168 GB Docker disk image cannot be reclaimed from inside Docker. `~/.cache/huggingface` is 38 GB. Reclaimed 3.5 GB by removing this run's merged worktrees, and T-0016-4's agent reclaimed 1.9 GB via `brew cleanup`, but that is a rounding error against the problem. **A container build is a hard prerequisite for T-0016-6 (App Runner service) and T-0016-8 (scheduled Fargate task).** User declined a Docker Desktop full reset by implication — ~20 named volumes hold other projects' Postgres/MinIO/ClickHouse data (`game-time`, `consolidate-positions-ledger`, `epic-1650`, `proc-gen-world`) and a reset destroys them. |
| T-0016-1's Dockerfile is unverified by build | EPIC-0016 T-0016-6, T-0016-8 | 2026-09-01 | Written and statically reviewed only; `docker build` never succeeded on this host. Do not treat the image as known-good. Either verify locally once disk allows, or let the first ECR push/App Runner deploy be the verification and budget for a debugging cycle there. |
| Reference/fundamental data (industries, indexes, countries, fundamentals, earnings calendars) has **no owner** | EPIC-1008, EPIC-1009, EPIC-1014 | 2026-09-01 | Was recorded as supplied by a "separate parallel workstream". User confirms no such work is defined — the quote behind it ("live data is being set up in another thread") meant T-0001-9 in this repo, not a separate human workstream. T-0001-9 supplies OHLCV plus sector and market cap (Nasdaq screener CSV) and nothing else on that list. Decide per data class: source it, drop the dependent capability, or have the port report it unavailable. Ports are already written, so this blocks end-to-end behavior, not epic work. |
| `render.yaml:47` health-checks `/api/spike/ping`, a route EPIC-1015 plans to retire | EPIC-1015 | 2026-09-01 | Repoint the health check before deleting the spike stack, or the Render backend deploy fails. Verified against `backend/api/routes/spike.py:24`. |
| `measure` and `splitInstances` have no equivalent in the spec's core tool list | EPIC-1015 | 2026-09-01 | User sign-off needed at T-1015-2 on whether these are deliberate capability drops. Nearest equivalent is follow-up `backtest_screener`. |
| Multi-step temporal setup matching may be only partially covered by the new filter tree | EPIC-1015 | 2026-09-01 | User sign-off needed at T-1015-2 on partial parity. |
| T-0001-2 unverified | T-0001-2 | 2026-08-30 | Human + real WebMCP browser + real AI agent must complete `T-0001-2-live-verification-runbook.md`. Deprioritized. |
| EPIC-0013 measured 688 MB peak at the epic's own target universe — 34% over the 512 MB budget | EPIC-0013 T-0013-6, T-0001-9 AC1/AC5 | 2026-09-01 | The ~13 GB load peak is gone, but a whole-universe search still widens to float64 panel-wide in `backend/infra/expression.py` (~121 B/row). Resident panel is 131 MB as predicted; the search is what overruns. Two options recorded in T-0013-6: trim the universe to ~1,000 names x 10y (measured 383 MB, fits today) or take the DuckDB-over-R2 rung early. **Needs a user decision.** Measured this session (synthetic panels, pessimistic "broad" pattern, `scripts/measure_universe_scale.py`): 2,000x10y = 5.04M rows -> 688 MB (fails); 1,500x7y = 2.65M rows -> 437 MB; 2,000x5y = 2.52M rows -> 385 MB; 1,000x10y = 2.52M rows -> 383 MB. Cost is ~linear in rows: peak ~= 83 MB fixed + ~120 B/row, so the budget is ~2.6M rows however it is sliced. **Correction (same session, absolute RSS):** those figures subtract a baseline taken *after* imports, but Render measures the whole process, and they used the trivial 2-step pattern. Measured absolutely on 2,000x5y with a realistic 3-step/4-study pattern: interpreter 14 MB -> +libs 90 MB -> +app imports 100 MB -> +whole-file Parquet read into `bytes` 217 MB -> +parse 364 MB -> before search 385 MB -> **peak during search 723 MB**, against a panel that is only 65.7 MB resident. **The 5-year cut does not fit 512 MB once studies are used.** Same panel, simple vs complex pattern: search growth 211 MB -> 348 MB (+65%). Three separable costs, data smallest: (1) `panel_io` reads the entire Parquet file into a Python `bytes` object before parsing, holding the compressed file and parsed frame live at once (~117 MB, and over R2 it forces a whole-object download); (2) a ~147 MB parse transient; (3) ~339 MB of search transients, the only one that grows with expression complexity. Chunking (T-0013-4) plus a streaming read projects to ~200 MB peak, flat in both universe size and expression complexity. Also fix `scripts/measure_universe_scale.py` to report absolute RSS -- as written, T-0013-6 would report success against a number the container never sees. |
| The expression evaluator's peak memory grows with expression complexity, not just panel size | EPIC-1009, EPIC-1011, EPIC-0013 | 2026-09-01 | The 688 MB figure was measured on the *simplest realistic* pattern (2 steps, one rolling call each). Four properties of `backend/infra/expression.py` and `backend/infra/pandas_engine.py` make cost scale with the expression, so studies and multi-condition filters re-inflate it after any dataset cut: (1) **no memoization** -- `expression.py:197` re-parses and re-evaluates a study on every reference, so a study referenced three times is computed three times, and study-on-study composition multiplies; (2) `pandas_engine.py:123` materializes **all** steps' condition Series in one list comprehension and holds them simultaneously; (3) `expression.py:210` materializes every operand of an `and`/`or` before combining, with no incremental fold; (4) the rolling helpers use `groupby.transform` with a Python lambda, which materializes per-group results and concatenates. Consequence: trimming the universe (5y, one exchange, etc.) and narrowing to float32 both buy a constant factor and leave the growth intact. The structural fix is **per-ticker chunked evaluation** -- every function in the catalog (`sma`/`ema`/`atr`/`highest`/`lowest`/`days_since`) is already per-ticker, and the engine already groups by ticker for each rolling call, so intermediates would size to one ticker's history rather than the whole panel, making peak independent of universe size *and* of expression complexity. That is the deferred T-0013-4, whose deferral rationale ("buys only headroom, which DuckDB-over-R2 gives for free") assumed the constraint was panel size; it is not. **Revisit T-0013-4 before cutting the dataset.** |
| `docs/design/screener-core/` and `docs/design/discovery-and-catalog/` were not updated in the 2026-09-01 spec reconciliation | EPIC-1009, EPIC-1008, EPIC-1011 | 2026-09-01 | `docs/design/panel-system/{spec,technical}.md` and `docs/design/workspace-revisions/{spec,technical}.md` are now fixed (same session, later pass) and match the fourteen-tool panel surface. Still stale: `docs/design/screener-core/technical.md:6` and `docs/design/discovery-and-catalog/technical.md:7,239` still name `select_result` and `edit_chart_studies`, tools retired by the reconciliation. An implementing agent reading either gets contradictory instructions. T-1007-7 anticipates this and instructs treating stale design docs as silent, but that is a workaround, not a fix. |
| `save_workspace_template` is in the revised tool spec but owned by no epic | EPIC-1006 or EPIC-1007 | 2026-09-01 | The revision added a Persistence row, `save_workspace_template` ("Save a reusable layout and panel configuration"), that the reconciliation pass did not assign. EPIC-1007's `apply_layout_template` consumes templates that nothing in the program creates. Assign it (EPIC-1006 owns Persistence; EPIC-1007 owns layout) or drop it from the spec. |
| Panel load path peaks ~13 GB (issue #13) | T-0001-9 AC1/AC5, EPIC-0013 | 2026-09-01 | Real blocker for real data. EODHD paid tier and R2 are NO LONGER blockers: key verified live 2026-09-01 (`dailyRateLimit` 100000, arbitrary tickers, 2,680 rows for NVDA over 10y) and R2 credentials are in the gitignored root `.env`. Land EPIC-0013's T-0013-1/T-0013-2 before attempting the backfill. |
| EPIC-0013 (market data storage, still being triaged) rearchitects the same OHLCV panel that EPIC-1008/EPIC-1011 read from — overlaps cross-epic reconciliation #4 below (bars-port ownership) | EPIC-1008, EPIC-1011, EPIC-0013 | 2026-09-01 | Once EPIC-0013 lands a spec, reconcile its storage interface against EPIC-1008's/EPIC-1011's port assumptions before Wave 1 (EPIC-1008) implements against a port that EPIC-0013 might reshape. |
| The new WebMCP surface's composition root has no owner — no ticket anywhere in EPIC-1006 through EPIC-1015 imports every epic's `build<Area>Tools()` builder and registers the combined list | EPIC-1015 (cutover blocks on this existing), all of EPIC-1006-1014 (their tools stay unreachable without it) | 2026-09-01 | Confirmed by EPIC-1008's epic review (independent [WIRING] audit grepped every EPIC-1006/1015 ticket, found none). EPIC-1006's own tool-surface ticket (T-1006-8) registers only its own tools; EPIC-1015's cutover tickets presuppose the new surface already exists rather than assembling it. Needs an explicit new ticket (likely under EPIC-1006 or EPIC-1015) before EPIC-1015 can cut over. See `docs/architecture/new-webmcp-surface.md`. |

## Cross-epic reconciliations pending

_Surfaced by Wave 0. Each needs one decision before the owning epic is
implemented; none can be settled by a single epic alone._

| # | Question | Raised by | Owner | Working assumption |
|---|----------|-----------|-------|--------------------|
| 3 | Pinned-run retention/expiry policy | EPIC-1009 + EPIC-1010 | EPIC-1009 | Eviction is an explicit error, TTL unset. Both epics flagged it; needs one number. Not yet decided. |

_Resolved 2026-09-01 (user: proceed on working assumptions, to unblock Wave 1 launch):
#1 `expected_revision` is optional-and-warn (not required-and-reject); #2 operation-registry
handlers are not required to be pure; #4 the OHLCV bars port is a narrow port owned by
EPIC-1011, aliasable to EPIC-1008's later. See Decisions Log._

_Resolved during Wave 0: `explain_result`'s contribution data (EPIC-1009
stores per-node evaluated value + pass/fail per match, so explain is a
lookup); wire casing (snake_case wire / camelCase internals, EPIC-1006
authoritative)._

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-01 | **T-0016-7 retargeted from "migrate R2 → S3" to "backfill directly into S3"** | Evidence that there is nothing to migrate: no root `.env` exists, `backend/.env` holds only `CORS_ALLOWED_ORIGINS`/`RATE_LIMIT_DEFAULT`/`EODHD_API_KEY` with **no R2 credentials**, and no document records a completed backfill — the plan itself said the backfill was blocked on EPIC-0013's T-0013-1/T-0013-2, which merged the same day. Corrects the plan's earlier claim that "R2 credentials are in the gitignored root `.env`". The retargeted ticket is also EPIC-0001's **T-0001-9 AC1**, unblocked by the same merge. Spends real EODHD quota. |
| 2026-09-01 | **Added T-0016-12: refuse to serve synthetic data in production** | Consolidating Wave 1 surfaced two defects no single ticket owned. (1) T-0016-3 renamed `R2_*` → `OBJECT_STORE_*` and cut the old names, but `render.yaml` still declared the old ones — so a redeploy would leave the bucket unnamed, fall back to the mock panel, and **serve synthetic prices as real while passing its health check**: the exact hazard this epic exists to remove, reintroduced by a rename. It also broke T-0016-10's rollback requirement, since rolling back to Render is only a rollback if Render still works. (2) The 2026-09-01 decision that "a production deploy must refuse to start on the mock panel" was never implemented. Fixed by an opt-in `REQUIRE_REAL_PANEL` env var (default off, so local checkouts and the suite are untouched), set on in `render.yaml`. |
| 2026-09-01 | **Docker reclaim scoped to images/containers/build cache only — volumes preserved** | The user approved reclaiming Docker's 168 GB. Inspection first found ~20 named volumes belonging to unrelated projects, including several Postgres data volumes. `--volumes` was therefore deliberately omitted: the approved intent was reclaiming space, not destroying other projects' databases. The prune then failed anyway on corrupted containerd metadata. |
| 2026-09-01 | **Credential leak found and fixed in `EodhdClient._get`** | Found during T-0016-5's AC6 audit, not by a test. The client chained `raise PriceSourceError(...) from exc`, and `requests.HTTPError`'s own message embeds the fully-resolved URL **including `api_token`** — so the paid EODHD key could reach any error log or traceback. Changed to `from None` with a regression test that fails without the fix. Worth remembering as a class of bug: exception chaining at an infra boundary is a project rule, and here the rule itself was the leak. |
| 2026-09-01 | EPIC-1008 closed (PR [#18](https://github.com/alekst23/webmcp-stock-screener/pull/18), not yet merged) with T-1008-8 filed as a non-blocking follow-up rather than fixed inline | 5-agent epic review found the epic's search-instruments code detects "no source configured" by string-matching an infra adapter's constant instead of a structural port/envelope field — real, but touches the shared envelope contract EPIC-1006 is concurrently building. Fixing it under review-gate pressure risked colliding with EPIC-1006's in-flight work more than the fragility itself costs; filed as T-1008-8 instead. |
| 2026-09-01 | Flagged EPIC-1006 (mid-run) to reuse EPIC-1008's `src/lib/surface/ids.ts`/`provenance.ts` instead of building a second stable-ID/provenance scheme | EPIC-1008 built these two modules first (it landed in Wave 1 alongside EPIC-1006) but scoped them explicitly for the whole surface, not just discovery — its own code comments say so. Neither of EPIC-1006's T-1006-1/T-1006-3 tickets reference them, since they were written before EPIC-1008 had shipped any code. Sent a live coordination message to the running EPIC-1006 agent rather than waiting to reconcile post-hoc; documented the surface-shared-module pattern in the new `docs/architecture/new-webmcp-surface.md`. |
| 2026-09-01 | **EPIC-0016 compute: App Runner, not ECS Fargate** | User decision, against the epic's own recommendation. Fargate was recommended for explicit task-level memory metrics and for running the nightly batch job on one platform. App Runner wins on cost and configuration: it bundles HTTPS and a stable hostname, removing a load balancer and a NAT gateway — roughly $50/month of fixed infrastructure existing only to front one container — and replaces a load balancer, target group, listener, security groups, and an ECS service/task-definition pair with one resource. The accepted cost is two platforms: the nightly delta cannot share App Runner because it serves HTTP only. |
| 2026-09-01 | **EPIC-0016 memory ceiling: 2 GB, not the recommended 4 GB** | User decision. 2 GB is ~2.8x the measured 723 MB absolute peak and a 4x removal of the 512 MB ceiling this epic exists to clear, so the blocker is genuinely gone. What it does not buy with confidence is the untrimmed 2,000 x 10-year universe, because peak grows +65% simple-to-complex pattern on the *same* panel — headroom here protects against user input, not dataset growth. Mitigation: memory stays a Terraform input, and App Runner's 1-vCPU tier offers 2/3/4 GB, so raising it is a one-line change. **T-0016-9's AC6 is now a real test** — a measured peak over ~1.4 GB must be reported as not fitting, not rationalized. |
| 2026-09-01 | **EPIC-0016 nightly delta: EventBridge Scheduler → standalone ECS Fargate task** | Forced by the App Runner choice, but the underlying reasoning is unchanged: `nightly_delta.py --catch-up` is the longest run the job has and the one invoked after failed nights, so Lambda's 15-minute ceiling binds on exactly the run that must not fail. Shape is a task definition and a cluster with no service, no load balancer, and no NAT gateway (public subnet, assigned public IP), so idle cost is ~zero and the two-platform cost is paid in Terraform, not monthly. |
| 2026-09-01 | **EPIC-0016 target: account `490284589142`, `us-east-1`, profile `alekst23`** | Confirmed empirically rather than asked: a `postgres` RDS instance `database-1` already runs in `us-east-1` on that account, and the profile's IAM principal is already `terraform-deploy-user`. Matching it keeps a later server-side workspace store from crossing regions and paying egress. |
| 2026-09-01 | **EPIC-0016 agents may apply to the live AWS account** | User decision. Agents run `terraform apply`, push images, migrate panel objects R2→S3, and measure real RSS on the deployed container. Bounded: no deletion or modification of pre-existing resources (`database-1` in particular), and nothing billed per-hour without a workload on it — explicitly no NAT gateway, no load balancer, no ECS service. T-0016-11 (decommission Render) remains user-gated. |
| 2026-09-01 | Resolved cross-epic reconciliations #1, #2, #4 by working assumption to unblock Wave 1 launch: `expected_revision` is optional-and-warn; operation-registry handlers are not required to be pure; the OHLCV bars port is owned by EPIC-1011, aliasable to EPIC-1008's later | User chose to proceed on working assumptions rather than deliberate further, via `/at-project-go`. Unblocks launching EPIC-1006 from scratch and closing EPIC-1008 (already implemented, unmerged) in the same wave. Reconciliation #3 (pinned-run retention/TTL) remains open — it only affects EPIC-1009/1010, Wave 2/3, not this wave. |
| 2026-09-01 | Revised `docs/reference/tool-spec.md`'s panel tool table (user-supplied) and reconciled EPIC-1006/1007/1008/1010/1011/1012/1014 against it | The revision establishes panel source (screener/watchlist/symbol-list/panel reference) and renderer (table/chart_grid/heatmap/scatter) as independent axes an agent sets separately (`bind_panel_source`, `set_panel_renderer`) — "screeners produce datasets; panels decide how those datasets are visualized." Reconciled by: renaming `get_workspace` to `get_canvas_state` (EPIC-1006, unchanged owner); expanding EPIC-1007 from 5 to 14 panel tools and 6 to 7 tickets, adding new ticket T-1007-7 (source/renderer contract registry) and new tools `duplicate_panel`, `apply_layout_template`, `split_panel`, `maximize_panel`, `bind_panel_source`, `set_panel_renderer`, `configure_chart_grid`, `unlink_panels`; retiring EPIC-1010's `configure_results_table`/`select_result` and EPIC-1011's `configure_chart`/`edit_chart_studies` as standalone tools in favor of those epics registering table-renderer and chart-renderer *contracts* into EPIC-1007's new registry, reached through EPIC-1007's generic `configure_panel_view`/`set_panel_selection`/`bind_panel_source` tools. Left open in EPIC-1007: whether the tool-spec's `"kind": "collection"` example needs a new panel kind or reuses `chart` with a `chart_grid` renderer (assumed the latter). Also left open, not resolved this pass: where panel title/visibility/collapsed-state — previously `update_panel`'s job — now lives; folded provisionally into `configure_panel_view` pending user confirmation. No code exists yet for any of these epics, so this was a docs-only reconciliation. |
| 2026-09-01 | Filed EPIC-0015 (DuckDB Query Engine) as a real epic and as issue [#15](https://github.com/alekst23/webmcp-stock-screener/issues/15), rather than leaving it as prose | The single largest architectural decision in the project existed only as paragraphs inside a deferred ticket and a design-doc section, all on an unmerged branch. `technical.md` named DuckDB as rung 2 with an explicit trigger, `T-0013-4` forbade hand-rolled chunking "without first rejecting DuckDB for a stated reason", and `T-0013-6` recorded the trigger as already fired -- but no ticket, contract, or estimate existed anywhere, and nothing addressed how multi-step temporal matching (`within=(min,max)`) becomes SQL, which is the hard part. Also recorded: the trigger fired for a **different reason than written**. `technical.md` set it at "resident memory at the target universe exceeds the instance budget's headroom"; resident memory is fine at 65.7 MB, and what overruns is evaluation transients driven by expression complexity. |
| 2026-09-01 | Sequencing of T-0013-4 (per-ticker chunking) vs EPIC-0015 (DuckDB) left OPEN, with both positions recorded | `T-0013-6` argues chunked condition evaluation is "exactly the hand-rolled query engine technical.md argues against building". The counter-position: per-ticker chunking is a loop boundary, not a scanner -- the engine already calls `groupby("ticker")` on every rolling operation, so the change is evaluating per group instead of materializing whole-panel Series; it adds no query planner, does not change the storage format, and is deleted in one commit when DuckDB lands. Roughly a day against a week-plus for the SQL port. Against it: if DuckDB is happening anyway, pandas-evaluator work is thrown away and the SQL port is unavoidable either way. Not resolved -- the user has not chosen, and EPIC-0015 records both rather than picking. |
| 2026-09-01 | T-0001-10 moved out of EPIC-0001 to issue #14 | Its ACs required filing before the 2026-09-03 deadline, which is no longer the objective, so the ticket could never be honestly closed as written. It also sat Open marked `Depends on: T-0001-9`, making EPIC-0001 look incomplete for a reason that no longer applies. Deliverables carry over; the real-data requirement now runs through EPIC-0013's T-0013-6. |
| 2026-09-01 | EPIC-0013 retargeted to POC scope; T-0013-4 (chunked streaming) deferred | User set the goal as a decent POC with a real DB understood as the production answer. Given that, a hand-rolled chunked scanner is a query engine built to be discarded when it starts mattering — it buys no latency (findInstances scans the whole universe by design), only headroom, which DuckDB-over-R2 gives for free off the same partitioned Parquet. Upgrade ladder recorded in technical.md. |
| 2026-09-01 | Panel universe trimmed by a liquidity/market-cap floor rather than taking all ~6,268 listed names | Product decision as much as sizing: thinly-traded microcaps distort pattern base rates. T-0013-6 fixes and records the cut. |
| 2026-09-01 | Filed #13 and triaged it as EPIC-0013 rather than patching `panel_io.py` in place | Fixing only the I/O boundary leaves residency linear in universe x history; panel size is a product input, so the ceiling would return. User chose the full-universe-on-free-tier target, which makes streaming in-scope. |
| 2026-09-01 | **Scrapped all work whose only purpose was fitting 512 MB.** EPIC-0015 closed, T-0013-4 cancelled, T-0013-6 retargeted | User direction: stop optimizing for constraints the large instance and database remove. The test applied was "is this broken at any instance size, or only under 512 MB?" **Scrapped** (workarounds): EPIC-0015 / #15 (DuckDB port -- existed only because 723 MB > 512 MB); T-0013-4 (hand-rolled chunked scanner -- cancelled, not deferred, since deferring implies it should eventually happen and it should not); the 5-year and single-exchange universe cuts; float32 evaluator arithmetic, study memoization, and the streaming-object-read gap -- all real inefficiencies, none required. **Kept** (broken at any size): EPIC-0013's T-0013-1/2/3/5 -- the row-object path costs 5.45 GB at the trimmed target and 17.1 GB at full universe, versus 318 MB / 995 MB compact, so it is unaffordable on any instance and its fix is required, not an optimization; T-0013-5 (staleness disclosure) is a correctness feature, not memory work; the two engine correctness bugs EPIC-0015 surfaced, extracted to #17 before closing it. |
| 2026-09-01 | **Hazard found by EPIC-0016: a role-based AWS deploy would silently serve mock data** | `infra/object_store.py:config_from_env` returns `None` unless all four `R2_*` variables are set, and `main.py` then falls back to the mock panel. That is correct for a local checkout, but on Fargate with an IAM task role there are no static keys -- so the app boots, the health check passes, and it serves **synthetic prices as though they were real**, invisibly. The project discloses staleness everywhere else (T-0013-5 exists for exactly this reason); this path discloses nothing. EPIC-0016's health-endpoint and secrets tickets must make "configured but unreachable store" and "no store configured" distinguishable from "serving real data", and a production deploy must refuse to start on the mock panel rather than fall back to it. |
| 2026-09-01 | Correction: moving object storage R2 -> S3 is **not** purely configuration | Recorded earlier in this session as an endpoint/credential change only. `object_store.py:26` hardcodes `_R2_REGION = "auto"`, an R2-specific value S3 rejects, so a real region has to be threaded through. Small, but it is code, and EPIC-0016's T-0016-3 (provider-neutral object store) is scoped accordingly. |
| 2026-09-01 | Recorded that `main` still carries the #13 bug | `backend/application/load_panel.py:45` calls `parquet_bytes_to_bars` -- the 1,081 B/row row-object path. The fix exists only on the unmerged `epic/EPIC-0013-market-data-storage`. #13 is labelled `intake:triaged`, which reads as handled; nothing has shipped. **Merging EPIC-0013 is a prerequisite for the AWS migration**, not an optional cleanup: deploying `main` as-is would put a 5.45 GB load path on the new container. |
| 2026-09-01 | **Re-platform the backend from Render to AWS** (issue #16, EPIC-0016). Long-running container, S3 storage, Cloudflare frontend stays | The 512 MB ceiling every memory decision this session fought is a Render **free-tier artifact**, not a requirement. The user has existing, already-paid AWS infrastructure including RDS/Aurora Postgres. The 2026-08-31 entry rejected an AWS re-platform "given the 2026-09-03 deadline"; that deadline was made secondary on 2026-09-01, so the sole stated reason for rejecting it was void. Measured peak of 723 MB fits comfortably in 2-4 GB, so the blocker is removed rather than engineered around. |
| 2026-09-01 | Container (ECS/Fargate or App Runner) chosen over Lambda for the API | The engine is **stateful-resident** -- it loads the panel into memory and keeps it there. Lambda would cold-start pandas/pyarrow and re-pull the panel per invocation (seconds per call for an interactive agent tool) and would force a query-per-request rewrite. A container keeps the current design working unchanged. The nightly delta is different -- short, batch, no resident panel -- and is a genuine Lambda fit; EPIC-0016 decides that separately. |
| 2026-09-01 | The liquidity/market-cap universe floor stays, but is now a **product** decision only, not a memory workaround | With real memory the universe no longer has to be trimmed to fit. The original rationale (thinly-traded microcaps distort pattern base rates) stands on its own; the 5-year and single-exchange cuts explored this session are dropped -- the 5-year cut was measured and did not fit 512 MB anyway once studies were used. |
| 2026-09-01 | EPIC-0015 (DuckDB query engine) **parked, not cancelled**; its trigger restated | Its entire justification was fitting 512 MB. With a 2-4 GB container the resident panel works as-is, so the port is no longer necessary. It is not cancelled because the underlying fault is real and unfixed: peak memory still grows with *expression complexity*, so it returns at some universe size. New trigger: when measured peak on the deployed container approaches its memory ceiling. When revisited, **re-evaluate Postgres against DuckDB** -- the earlier "Postgres is dominated by DuckDB" reasoning rested on Postgres meaning another paid service, and RDS/Aurora is already paid for. Counterpoint to weigh then: Postgres is a row store and this is a whole-universe columnar scan, which is DuckDB's home ground. EPIC-0015 also independently found that DuckDB bounds memory *by spilling to disk*, which the Render free plan could not provide -- a container can, removing that objection too. |
| 2026-09-01 | Split epic numbering into two bands: **EPIC-0XXX for issue-derived, EPIC-1XXX for local** -- and renumbered every existing issue-derived epic to match | The old rule (`1000 + issue number`) shared a number space with standalone numbering (`highest existing + 1`), so the two allocators collided the moment both were used. Wave 0 created ten local epics as EPIC-1006..EPIC-1015 -- exactly the numbers reserved for issues #6..#15 -- which forced #13 and #15 to be renumbered by hand and would have forced #14 next. The split makes collision impossible below issue #1000 and makes the mapping legible both ways: strip the padding from EPIC-0013 and you have issue #13. Mapping applied: **EPIC-1001->0001 (#1), 1002->0002 (#2), 1003->0003 (#3), 1004->0004 (#4), 1005->0005 (#5), 1016->0013 (#13), 1017->0015 (#15)**; tickets renamed to match (`T-1001-9` -> `T-0001-9`). The ten Wave 0 epics keep 1006-1015. 583 references updated on `main` plus each epic branch; verified 0 stale references across all four branches; typecheck, 117 frontend and 60 backend tests green after. Global skills `at-epic-new` (5a, 5c) and `at-issue-triage` (Step 2) updated with the new rule and the reason. **Caveat: PRs #6-#9 and their merge commits still name the old numbers and cannot be rewritten** -- this mapping is the reference for reading them. |
| 2026-09-01 | EPIC-0015 numbered off-rule for the same reason as EPIC-0013 (derivation from #15 gives EPIC-1015, taken by Wave 0's Legacy surface cutover) | Second occurrence of the same collision. The derivation rule maps issue #N to EPIC-10NN, but the Wave 0 batch claimed 1006-1015 by fiat, so every issue numbered 6-15 now collides. Names correlated explicitly instead: issue #15 <-> EPIC-0015 <-> `epic/EPIC-0015-duckdb-query-engine` <-> `docs/design/duckdb-query-engine/`, with the deviation recorded in the epic file and in a comment on the issue. |
| 2026-09-01 | EPIC-0013 numbered off-rule (derivation gives EPIC-1013, taken by Wave 0's Safety layer) | Using the derived number would have collided with unrelated specced work. Deviation recorded in the epic file. |
| 2026-09-01 | Feature slug `market-data-storage`, not `panel-system` | `panel-system` already owns the agent-driven UI panel container — an unrelated concept sharing the word 'panel'. |
| 2026-09-01 | Panel degradation is serve-and-disclose, not fail-closed | User decision. A failed nightly cron shouldn't take the app down, but stale or partial data must never read as current and complete. |
| 2026-09-01 | Hardened `at-project-go`, `at-epic-new`, `at-epic-run` (global skills, not project-specific) after this session's Step-6 cleanup deleted a live worktree belonging to a different, concurrently-running session | The user asked "did you destroy any work on main?" — investigation found no `main` damage, but found the actual cause: cleanup deleted-by-glob-pattern instead of by provenance. Fixed: a run manifest scopes cleanup to only what the current run launched; `git worktree remove` no longer forces past uncommitted changes; epic numbering can be caller-pinned to avoid concurrent-scan collisions; agents in a fan-out no longer edit shared index files. See `~/.claude/skills/{at-project-go,at-epic-new,at-epic-run}/SKILL.md`. |
| 2026-08-30 | Pre-approved the ~$20/mo EODHD paid-tier upgrade for T-0001-9, to proceed automatically once T-0001-8 unblocks it | Deadline is 2026-09-03 1pm PT; avoids re-asking mid-crunch |
| 2026-08-30 | Uncommitted ticker-charts/instance-cache work (started by ChatGPT Codex) was finished rather than discarded | User confirmed this is live in-progress work worth keeping, not scratch — landed in commit `2b039af` |
| 2026-08-31 | Ran EPIC-0002 through EPIC-0005 (all triaged from #2-#5, specs already written) through design/tests/implementation this run, per explicit user instruction via `/loop`, despite autonomous-mode's normal "no new initiatives" restriction | User's `/at-project-go` argument explicitly named these four epics; they were already triaged with specs, not brand-new scope |
| 2026-08-31 | Ran `/at-epic-close` (CI + 5-agent review + PR) for EPIC-0002 through EPIC-0005 per explicit user instruction ("close all and merge to main") via `/loop` | Follow-up to the implementation run; user directed closing all four in this session |
| 2026-08-31 | Asked the user whether to auto-merge each PR or stop at PR creation (the skill's default is to never merge directly); user chose auto-merge each once CI/review pass | `at-epic-close` intentionally never merges on its own — explicit user instruction overrides that default for this batch only |
| 2026-08-31 | EPIC-0002's PR was squash-merged to origin/main via GitHub while local `main` still carried unpushed plan-doc commits, causing a divergent-history merge conflict on reconcile | Resolved by resetting local `main` to origin's tip (a pure superset for all code — origin already contained everything local had via the epic branch's ancestry) and reapplying only the local-only `project.md` tracking edits on top |
| 2026-08-31 | EPIC-0003/1004/1005 all shared the same problem as EPIC-0002 above (forked from a stale pre-EPIC-0002 `main`, causing inflated diffs and would-be merge conflicts) — rebased each onto the current `main` tip before its CI/review pass, resolving real content conflicts (shared `spec.md`/`+page.svelte` sections) by hand each time | Kept each epic's PR diff scoped to its own actual changes instead of re-showing already-merged sibling-epic content, and avoided GitHub-side merge conflicts at squash time |
| 2026-08-31 | EPIC-0005's epic review found one genuine functional bug (loading a snapshot left a stale `focusedView`, risking the chart showing data for the wrong instance) — fixed it directly on the epic branch before opening the PR, rather than filing a follow-up ticket | Unlike the other findings across all four epics (real but lower-severity/non-blocking), this one could silently show factually wrong research data to the user — judged worth fixing before close rather than deferring |
| 2026-09-01 | R2 bucket blocker closed — credentials (`R2_BUCKET_NAME`, `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_TOKEN_VALUE`) are present in the gitignored root `.env` | User created the bucket between runs; the panel object store T-0001-9 depends on is ready |
| 2026-09-01 | Built T-0001-9's full pipeline against fixtures rather than waiting for the API key, deferring only the live backfill run and the AC5 spot-check | The key's absence blocks one command, not the code; with the 2026-09-03 deadline there was no reason to leave the implementation idle while waiting for a paste |
| 2026-08-31 | Dropped the Render persistent disk from `render.yaml`/T-0001-8's mock deploy; T-0001-9's real panel data will persist in object storage (R2/S3) instead of a Render disk | Discovered live during T-0001-8 deployment that Render's free tier doesn't support disks at all, and the paid tier needed for one (~$25/mo) costs far more than R2/S3 object storage for this data volume (~60-90MB); the mock panel regenerates deterministically on every deploy instead, at zero functional cost. Considered a full AWS re-platform instead but rejected given the 2026-09-03 deadline — real migration work for marginal savings over the object-storage fix, which keeps the already-working Render pipeline intact |
| 2026-09-01 | Objective changed: implement `docs/reference/tool-spec.md` as a **full replacement** of the 11-tool pattern surface, with the 2026-09-03 hackathon deadline explicitly secondary | User chose "Full replacement per spec" + "Full spec, deadline is secondary" when presented with the scope options and the concern that 33 tools are not buildable to quality in two days |
| 2026-09-01 | New surface is built **alongside** the legacy one in new files; a final user-gated epic (EPIC-1015) retires the legacy tools/UI | User chose "Build new alongside, retire at the end" — keeps `main` deployable throughout and keeps the deployed hackathon submission working while the replacement is under construction |
| 2026-09-01 | ~~Reference/fundamental market data is sourced from a separate parallel workstream~~ — **retracted 2026-09-01** | Rested on reading "live data is being set up in another thread" as a separate human workstream. It meant T-0001-9, in this repo. User confirms no such work is defined. The reference-data dependency for EPIC-1008/1009/1014 is unowned; see Blockers. Left visible rather than deleted so the same inference is not made again from the same quote. |
| 2026-09-01 | Behavioral specs derived from `docs/reference/tool-spec.md` instead of running ten `/at-epic-design` intent interviews | The doc is already a detailed design artifact the user wrote; its two genuine gaps (screener data source, legacy migration) were resolved by direct question. Epics record any remaining gap as an explicit "Open question" rather than guessing |
| 2026-09-01 | EPIC-1006 owns the spec's common contract (stable IDs, `expected_revision`, `idempotency_key`, mutation envelope, provenance type, extensible operation registry) as shared infrastructure the other nine epics import | The contract is shared by every mutating tool; letting six epics each invent their own envelope would make consolidation a wreck. Makes 1006 the one genuine hard dependency in the program |
| 2026-09-01 | Wave 0 (epic creation) run as ten parallel worktree agents with **pinned** epic numbers | Concurrent `/at-epic-new` runs would each auto-assign the same next number and collide |

## Completed

| Item | Type | Completed | Result |
|------|------|-----------|--------|
| EPIC-0002: Unified Action Log | epic | 2026-08-31 | Merged via [PR #6](https://github.com/alekst23/webmcp-stock-screener/pull/6) (squash), closing #2. 5-agent review passed; 2 non-blocking follow-ups filed (T-0002-4, T-0002-5, Open). |
| EPIC-0003: Panel Action Set | epic | 2026-08-31 | Merged via [PR #7](https://github.com/alekst23/webmcp-stock-screener/pull/7) (squash), closing #3. 5-agent review passed; 2 non-blocking follow-ups filed (T-0003-3, T-0003-4, Open). |
| EPIC-0004: WebMCP Status Header | epic | 2026-08-31 | Merged via [PR #8](https://github.com/alekst23/webmcp-stock-screener/pull/8) (squash), closing #4. 5-agent review passed; 1 non-blocking follow-up filed (T-0004-2, Open) — 3 of 5 agents independently converged on the same finding (unhandled connect-failure rejection). |
| EPIC-0005: Workspace Snapshots | epic | 2026-08-31 | Merged via [PR #9](https://github.com/alekst23/webmcp-stock-screener/pull/9) (squash), closing #5. 5-agent review found one real bug (stale `focusedView` after snapshot load) — fixed directly on the branch before merge. 3 non-blocking follow-ups filed (T-0005-3, T-0005-4, T-0005-5, Open). |
| T-0001-8: Deploy & ops (mock) | ticket | 2026-08-31 | Backend live on Render, frontend live on Cloudflare Workers. All 5 ACs verified (HTTPS, mock data, CORS, rate limiting, real product endpoint working end-to-end). See `docs/reference/deployment.md`. Live during deployment: Render disk isn't supported on free tier (dropped it); Cloudflare's current onboarding needed `wrangler.jsonc` instead of classic Pages config. Unblocks T-0001-9. |

| UI/WebMCP hotfixes (#10, #11, #12 + bridge follow-up) | hotfix | 2026-08-31/09-01 | Four hotfixes landed on `main` after the last plan update, all judge-visible-surface fixes: always show the tool count in the header (#10), workbench UI refactor — visible tool list, log moved to the bottom, compact snapshots (#11), report whether WebMCP tools are actually callable rather than merely present (#12), and `7e6f4a6`, which installs a page-owned WebMCP bridge instead of trying to predict browser support. |
| #10 always-visible tool count | fix | 2026-08-31 | Merged (PR #10). Header shows the tool count unconditionally. |
| #11 workbench UI refactor | fix | 2026-09-01 | Merged (PR #11). Visible tool list, log moved to bottom, compact snapshots. |
| #12 bridge status accuracy | fix | 2026-09-01 | Merged (PR #12). Status reports whether WebMCP tools are actually callable, not whether the browser claims support. |
| Page-owned WebMCP bridge | fix | 2026-09-01 | Commit `7e6f4a6`. The page installs its own bridge instead of predicting browser support, so the advertised tool surface is always the callable one. Typecheck clean, 112/112 tests pass. |

_EPIC-0001 is still in progress — ticket-level completions (T-0001-1, 3, 4,
5, 6, 7) are tracked in `docs/plan/EPIC-0001/_epic.md`._

## Last Run

- **Date:** 2026-08-31
- **Actions taken:** Per explicit user instruction ("close all and merge to
  main") ran the full `/at-epic-close` pipeline (CI → merge-queue check →
  5-agent epic review → follow-up tickets → PR → merge) for all four of
  EPIC-0002 through EPIC-0005, back to back. User approved auto-merging each
  PR once CI/review passed, once, up front for the whole batch. Result: all
  four merged (PRs #6-#9), all four source issues (#2-#5) auto-closed, no
  open issues remain. Final `main` verified clean (typecheck 0 errors,
  59/59 tests, build succeeds) after all four landed.

  Two recurring problems surfaced and were handled each time: (1) each epic
  branch had forked from a stale pre-EPIC-0002 `main`, so before each one's
  CI/review pass it needed rebasing onto the then-current `main` tip,
  resolving real content conflicts (shared `spec.md` sections, `+page.svelte`
  wiring) by hand; (2) after each squash-merge, local `main` needed
  `git fetch && git reset --hard origin/main` to stay in sync (squash merges
  don't fast-forward against local linear history). EPIC-0005's review also
  caught one genuine functional bug (stale focus-detail view after a
  snapshot load could show the wrong chart data) — fixed directly on the
  branch rather than deferred.

  Earlier in the same run, a mis-launch (background agents sharing this
  session's working directory instead of isolated worktrees) was caught and
  corrected before any writes occurred — see the Decisions Log entry from
  the implementation phase.

  EPIC-0001 untouched throughout — still blocked on T-0001-2/T-0001-8.
- **Next suggested:** Re-check T-0001-2/T-0001-8 for human progress; once
  T-0001-8 is done, resume the T-0001-9 → T-0001-10 chain. The 9 follow-up
  tickets left across EPIC-0002/1003/1004/1005 (T-0002-4/5, T-0003-3/4,
  T-0004-2, T-0005-3/4/5) are all non-blocking and low priority relative to
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
  sign-offs. EPIC-0001's remaining tickets (T-0001-2/9/10) stay
  deprioritized but open.
- **In-flight at close:** A *different, concurrently-running session* is
  triaging issue #13 into EPIC-0013 (market data storage) — worktree
  `.worktrees/triage-13` on branch `epic/EPIC-0013-market-data-storage`,
  one uncommitted file (`docs/design/market-data-storage/spec.md`), not
  reviewed or touched by this session. Do not clean up that worktree or
  branch; it is not this session's to manage.
- **Next session should:** Check whether EPIC-0013's triage has landed
  (`git log epic/EPIC-0013-market-data-storage`, `git worktree list`) before
  doing anything else, since it overlaps EPIC-1008/EPIC-1011's OHLCV-bars
  port ownership question. If clear, resolve the four cross-epic
  reconciliations (recommend: required-and-reject for `expected_revision`,
  pure handlers required), then launch Wave 1 (`/at-epic-run EPIC-1006` and
  `/at-epic-run EPIC-1008` in parallel). Do not launch EPIC-1015 without
  explicit user sign-off on its two capability drops.

## Last Run (2026-09-01, session closed via /at-project-sleep)

- **Trigger:** `/at-project-go T-0001-9`, then user redirect. User note at
  close: *"outline the next steps so we can resume next time"*.
- **Shipped:** Nothing merged to an epic or to origin. Five plan/doc commits
  on local `main` (`ea7ed84`, `8a8d1cb`, `413faff`, `582004b` + this one).
- **Scaffolded, not launched:** EPIC-0013 (5 tickets scheduled + 1 deferred)
  on `epic/EPIC-0013-market-data-storage` (`13afd89`, `fc73984`). T-0001-9's
  implementation on `feat/T-0001-9-real-data-pipeline` (`8448059`).
- **Filed:** #13 (panel load path, triaged -> EPIC-0013), #14 (POC packaging,
  supersedes T-0001-10, untriaged).
- **Deferred:** T-0013-4 (chunked streaming) — DuckDB-over-R2 is the
  designated next rung instead.
- **In-flight at close:** Nothing running. No worktrees. Another session has
  been writing this repo concurrently — see Blockers.
- **Next session should:** Merge `feat/T-0001-9-real-data-pipeline` first; it
  is done, CI-green, and EPIC-0013 declares a hard dependency on it, so
  leaving it unmerged makes 1016 stack on a branch. Then run EPIC-0013's
  T-0013-1 and T-0013-2 — those two alone remove the ~13 GB load peak and
  make a real backfill physically possible. A real backfill of a trimmed
  liquid universe comes immediately after, which is when live data actually
  arrives; the rest of EPIC-0013 (T-0013-3/5/6) hardens it. Verify before
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

## Last Run (2026-09-01, session closed via /at-project-sleep)

- **Trigger:** User asked to revise `docs/reference/tool-spec.md`'s panel
  tool table (user-supplied content: source/renderer separation, 14 panel
  tools) and update the planned epics if necessary, then closed with
  "lets save this plan for next session."
- **Shipped:** Nothing to production — docs-only. Revised
  `docs/reference/tool-spec.md`'s panel section and added its "Panels:
  source and renderer are separate" section; reconciled
  EPIC-1006/1007/1008/1010/1011/1012/1014 against it (EPIC-1007 gained
  ticket T-1007-7 and grew from 5 to 14 tools; EPIC-1010/1011 shrank to
  renderer-contract contributors); brought
  `docs/design/panel-system/{spec,technical}.md` and
  `docs/design/workspace-revisions/{spec,technical}.md` in line with the
  same model. All of this is now on `main` (commits `cdc349e`, `83ed25d`).
  Note: this session never ran `git commit` itself — a different,
  concurrently-running session appears to have sweep-committed this
  session's pending working-tree edits alongside its own unrelated work
  (`83ed25d` bundles this session's design-doc fix together with an
  unrelated epic-renumbering commit). Confirmed via `git log` that no
  content was lost, but flagging the pattern — see
  `feedback_concurrent_sessions_this_repo.md`.
- **Scaffolded, not launched:** No change from this session — still zero
  implementation code across the whole EPIC-1006-1015 program, aside from
  EPIC-1008 and EPIC-0013's unmerged branches, which are the concurrent
  session's work, not this one's.
- **Filed:** Nothing.
- **Deferred / needs your decision:**
  1. EPIC-1007 Open Question #6 — the tool-spec's `"kind": "collection"`
     example matches none of the 8 registered panel kinds; assumed `chart`
     + `renderer: chart_grid` instead of a new kind.
  2. EPIC-1007 Open Question #7 — where panel title/visibility/collapsed
     state live now that `update_panel` is gone; provisionally folded into
     `configure_panel_view`.
  3. `save_workspace_template` (new in the revised spec) has no owning
     epic — assign to EPIC-1006 (owns Persistence) or EPIC-1007 (owns
     layout), or drop it.
  4. `docs/design/screener-core/` and `docs/design/discovery-and-catalog/`
     still reference retired tools (`select_result`, `edit_chart_studies`)
     — same fix panel-system/workspace-revisions already got, not yet
     applied to these two.
- **In-flight at close:** Nothing running from this session. Confirmed via
  `gh pr list` that no PRs are open. The concurrent session's own threads
  (epic renumbering into the EPIC-0XXX/1XXX band split, EPIC-1008 and
  EPIC-0013 implementation, EPIC-0015 filing) are visible in git history
  but not this session's to manage.
- **Next session should:** Get the user's call on the two EPIC-1007 open
  questions and `save_workspace_template`'s ownership, finish the
  screener-core/discovery-and-catalog design-doc fix, then — per the
  existing wave order — launch EPIC-1006 first (still the one true
  zero-dependency foundation with no code yet), followed by EPIC-1007
  through T-1007-7, before EPIC-1010/1011's renderer contracts can wire
  in. EPIC-1008 and EPIC-0013 already have unmerged, implemented branches
  awaiting `/at-epic-close` — check those first since they may be quicker
  wins than starting EPIC-1006 cold.
