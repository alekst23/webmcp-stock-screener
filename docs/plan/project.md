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

**EPIC-1006 through EPIC-1014 are now all merged to `main`** (2026-09-02).
Program build-out is functionally complete behind feature flags — the new
33-core-tool (+13 follow-up) surface exists in full, in new files, with the
legacy 11-tool surface still untouched and `main` still deployable. Every
new-surface tool group ships behind its own flag
(`WORKBENCH_TOOLS_ENABLED`, `SCREENER_TOOLS_ENABLED`, `CHART_TOOLS_ENABLED`,
`SIMILARITY_TOOLS_ENABLED`, and EPIC-1014's followup-surface flag), all
still `false` — nothing in this program is live yet. The remaining phase is
EPIC-1015: flip the flags on, cut the composition root over, and retire the
legacy surface, gated on explicit user approval per the 2026-09-01 decision.

**Why this phase:** the user chose full replacement per spec over retrofitting
the existing tools. The spec's common contract (stable IDs,
`expected_revision`, `idempotency_key`, the mutation envelope, provenance) is
shared by every mutating tool, so EPIC-1006 is a hard foundation and the rest
fan out behind it.

**Why this phase:** the user chose full replacement per spec over retrofitting
the existing tools. The spec's common contract (stable IDs,
`expected_revision`, `idempotency_key`, the mutation envelope, provenance) is
shared by every mutating tool, so EPIC-1006 is a hard foundation and the rest
fan out behind it.

## Active Work

| Item | Type | Status | Branch | Notes |
|------|------|--------|--------|-------|
| EPIC-1006: Workspace, revisions & common tool contract | epic | **merged to `main`** ([#19](https://github.com/alekst23/webmcp-stock-screener/pull/19), merge commit `5ff71d4`, 2026-09-02) | `epic/EPIC-1006-workspace-revisions-common-tool-contract` | All 8 tickets implemented; 5-agent epic review found and fixed 3 critical bugs before merge (`save_workspace` bypassing idempotency replay and change-history recording; change-history pruning never evicting, silently defeating the 200-record cap; a swallowed `localStorage` write failure that let the mutation envelope report success). Follow-ups T-1006-9/10/11 remain Open. The shared contract modules now live on `main` at `src/lib/workbench/domain/` — **this is the authoritative common contract** for EPIC-1007/1009/1011/1012/1013. |
| EPIC-1007: Panel system | epic | **merged to `main`** (local merge, no PR, 2026-09-02) | ~~`epic/EPIC-1007-panel-system`~~ (merged; branch kept, worktree cleaned up) | **Done: all 9 tickets landed.** 814/814 tests, typecheck clean across 405 files on `main` after merge. Extension points, verified by tests registering fictional kinds/renderers with zero edits to this epic: `src/lib/panels/registry/panelKindRegistry.ts` (`registerPanelKind`, `createPanelRegistry`) and `src/lib/panels/registry/sourceRendererRegistry.ts` (`registerSourceType`, `registerRendererType`) — EPIC-1010/1011/1012 plug into these. Tools live at `src/lib/panels/tools/` (not `src/lib/webmcp/v2/panelTools.ts` as `technical.md` still says — doc is stale). **Known follow-up, not blocking:** `get_canvas_state` doesn't project panel state for kinds outside EPIC-1006's closed `PanelKind` union, because panel state lives in `doc.extensions['panel_system']` and `normalizeWorkspace` silently drops unknown kinds from the `doc.panels`/`layout`/`links` projection — needs that union opened. Also open: spec Open Question 5 (the `collection` kind) resolved by assumption (`chart` + `chart_grid`), not confirmed; `set_panel_renderer` takes no config argument, matching the use-case contract but contradicting T-1007-5's AC6 prose. |
| EPIC-1008: Discovery & catalog | epic | **merged to `main`** ([#18](https://github.com/alekst23/webmcp-stock-screener/pull/18), merge commit `d757ba1`, 2026-09-02) | `epic/EPIC-1008-discovery-and-catalog` | All 7 core tickets Done; T-1008-8 remains an Open follow-up. Merged second, so it absorbed the expected `docs/architecture/README.md` add/add conflict — resolved as a union of both epics' rows. **First integration of both epics verified before merge: 390/390 tests pass, typecheck clean across 311 files.** Its contract modules landed at `src/lib/surface/`. |
| EPIC-1009: Screener core | epic | **merged to `main`** (local merge, no PR, 2026-09-02) | ~~`epic/EPIC-1009-screener-core`~~ (merged; branch kept, worktree cleaned up) | **Done: all 10 tickets landed.** 1884/1884 tests, typecheck clean across 523 files on `main` after merge. **`run_id`/pinned-run contract** (EPIC-1010 consumes verbatim): `src/lib/screener/run.ts` (`ScreenerRun`, `ScreenerRunRefusal`, `ScreenerMatch`, `makeScreenerRun`, `toWireScreenerRun`), `src/lib/screener/ports.ts` (`PinnedRunStore` — no execute/refresh member, so "no silent rerun" is structural, proven by a key-enumeration test), `src/lib/screener/runStore.ts` (`createPinnedRunStore`). Retention: eviction is an explicit error, TTL unset, policy pluggable. **Per-match filter-node evaluation** (for `explain_result`): `ScreenerMatch.nodeEvaluations: Record<ResourceId, FilterNodeEvaluation>`, populated for every enabled node including groups, retained only for matches inside the result limit. Six tools gated behind `SCREENER_TOOLS_ENABLED = false`. Implemented entirely in browser-side TypeScript (`src/lib/screener/`, `src/lib/webmcp/screener/`) rather than the Python backend the design docs name — matches how the sibling epics landed; `docs/design/screener-core/technical.md` still names stale `scr_`/`fnode_`/`run_` ID prefixes, EPIC-1006's `ids.ts` scheme was used instead (doc is stale, not the code). |
| EPIC-1010: Results & explain | epic | **merged to `main`** (local merge, no PR, 2026-09-02) | ~~`epic/EPIC-1010-results-and-explain`~~ (merged; branch kept, worktree cleaned up) | **Done: all 8 tickets landed.** 2284/2284 tests, typecheck clean across 614 files on `main` after merge. Results-table config model, bounded results page over EPIC-1009's `PinnedRunStore`, explanation domain model, `get_screener_results`/`explain_result` use cases and tools, the real `results_table` panel kind wired into EPIC-1007's registry. **Four cross-epic extensions to already-merged sibling code, each reviewed and approved before merging:** (1) optional `validateSelection` hook on `RendererTypeDefinition` (EPIC-1007); (2) `ScreenerRun` retains node evaluations for every evaluated instrument, not just matches, plus pinned `filterTree`/`rankingSpec` snapshots (EPIC-1009) — **~80x worst-case storage increase under the default retention policy, documented; `RunRetentionPolicy` tuning may be warranted later**, tracked as a follow-up, not a blocker; (3) `PanelFrame.svelte` passes `{panel, linkedValue, onBroadcast}` to a panel kind's real component instead of zero props (EPIC-1007); (4) panel-kind/renderer registration is now genuinely order-independent (real always overwrites a placeholder regardless of call order) — **this closes the blocker EPIC-1012 filed** (no unregister/replace path existed before; EPIC-1012's local test-scoped workaround is now superseded but harmless to leave as-is). |
| EPIC-1011: Chart tools | epic | **merged to `main`** (local merge, no PR, 2026-09-02) | ~~`epic/EPIC-1011-chart-tools`~~ (merged; branch kept, worktree cleaned up) | **Done: all 9 tickets landed.** 1524/1524 tests, typecheck clean across 463 files on `main` after merge. **Captured-setup contract** (EPIC-1012 consumes verbatim): `src/lib/workbench/chart/domain/capturedSetup.ts` — `buildCapturedSetup`, `readCapturedSetup(s)`, `writeCapturedSetup`, `toWireCapturedSetup`, `normalizeCapturedSetup`; records live at `extensions.chart_setups`, copied so reconfiguring/deleting the source panel leaves them byte-identical. **OHLCV bars port:** `src/lib/workbench/chart/domain/seriesPort.ts` — `ChartSeriesPort.fetchSeries(request)`, window is a required explicit `{start,end}` (no unbounded fetch expressible), `appliedPriceAdjustment` can be `null` and must not be defaulted by consumers. Chart-renderer contract registers into EPIC-1006's operation registry as five `chart.*` mutation kinds (not standalone tools, per the 2026-09-01 reconciliation) via `registerChartPanelContract(registry, deps)` — written structurally since EPIC-1007 wasn't on `main` yet when this landed; needs a wiring check once EPIC-1007 and EPIC-1011 are both live. Also fixed a real bug in EPIC-1006's `operationRegistry.ts`: `foldApply` was silently dropping per-operation warnings (mutation-checked test added). Gated behind `CHART_TOOLS_ENABLED = false`. |
| EPIC-1012: Similarity search | epic | **merged to `main`** (local merge, no PR, 2026-09-02) | ~~`epic/EPIC-1012-similarity-search`~~ (merged; branch kept, worktree cleaned up) | **Done: all 8 tickets landed.** Frontend: 1973/1973 tests, typecheck clean across 548 files. Backend: 198/198 tests (5 pre-existing skips). Similarity feature/scoring contract + pandas-based engine reusing the existing panel-wide `groupby`/`rolling` technique (Python by design, per the ticket — see `docs/plan/EPIC-1012/T-1012-2-similarity-engine.md`), the `similar_opportunities` panel kind, HTTP search/explain API, `find_similar_setups`/`explain_similarity`/`compare_setups` tools, wired behind `SIMILARITY_TOOLS_ENABLED`. Backend wiring is additive-only (`backend/domain/errors.py` +3 exception subclasses, `backend/main.py` +25 lines registering the router). **Real gap found and worked around at the time, since resolved:** flagged `defaultPanelKinds.ts`'s unconditional placeholder registration as having no unregister/replace path in `PanelRegistry` (EPIC-1007); worked around it locally with test-scoped registries. **EPIC-1010 fixed the root cause 2026-09-02** (order-independent real/placeholder precedence) — see Blockers, resolved. |
| EPIC-1013: Safety layer (preview & apply) | epic | **merged to `main`** (local merge, no PR, 2026-09-02) | ~~`epic/EPIC-1013-safety-preview-apply`~~ (merged; branch kept, worktree cleaned up) | **Done: all 6 tickets landed.** 553/553 tests, typecheck clean across 328 files on `main` after merge (was 403 before). Atomicity: apply commits the candidate document the preview already computed rather than re-folding the batch, clones the pre-apply document, and on any throw mid-commit writes the clone back before rethrowing — closing a real half-applied window in EPIC-1006's `RevisionService.recordSuccess` (calls `repository.put` then `repository.putRevision` with no rollback). Rollback path is proven by a dedicated test (`applyPreviewedChanges: atomicity / rollback (AC8)`) that fails if the rollback call is removed. Registry-genericity proven by source-scan tests: a novel operation kind never appears in `batchEvaluation.ts` or `safetyTools.ts`. One caveat: `registerWorkbenchTools.ts` (EPIC-1006's surface, still gated `WORKBENCH_TOOLS_ENABLED = false`) was modified — sibling epics may conflict there on merge. |
| EPIC-1014: High-value follow-up tools | epic | **merged to `main`** (local merge, no PR, 2026-09-02) | ~~`epic/EPIC-1014-followup-tools`~~ (merged; branch kept, worktree cleaned up) | **Done: all 11 tickets landed.** Frontend: 2913/2913 tests, typecheck clean across 748 files. Backend: 289/289 tests. Typed expression model/validator, computed fields + custom studies, derive-filters-from-captured-setup, similarity-search refinement, backtest evaluation engine + tools, watchlists, alert draft/preview, native human-only activation review gate, export-with-provenance, final 13-tool WebMCP registration. **Both epic-defining safety properties verified with adversarial tests**, not just asserted: no-code-execution (smuggled SQL/JS rejected at every string-accepting expression node, plus a source scan for `eval`/dynamic `Function`); no-silent-arming (a suite sweeps the full 13-tool surface including undo/replay/stale-revision/undo-supersession paths and proves no sequence reaches `armed`; found and fixed one real bug in the process — undoing `disable_alert` could have re-armed an alert). Extended EPIC-1006's `ResourceKind` enum with `backtest`/`export`/`computedfield`/`customstudy`, reviewed before merging; this run also caught and fixed an in-flight inconsistency where one ticket had worked around the same need with a local ID generator instead of the canonical extension. **Known gaps, documented not fixed:** EPIC-1011's chart engine has no rendering path for custom studies yet (`create_custom_study` validates/stores/catalogs correctly; plotting is a follow-up); `ScreenerRun` doesn't pin `UniverseSpec`, only a count. |
| Provenance contract unification | fix | **merged to `main`** (`b0249ea`, local merge, no PR — 2026-09-02) | ~~`fix/unify-provenance-contract`~~ (merged and deleted) | **Done: 403/403 tests, typecheck clean across 314 files on `main` after the merge** (was 399 before; 4 net-new tests for historical-vs-static, TTM representability, and wire omission of absent optionals). Resolved the Blockers-table contract fork: `src/lib/workbench/domain/provenance.ts` (EPIC-1006) wins as the canonical record; `src/lib/surface/provenance.ts` is reduced to the discovery-specific `DiscoveryEnvelope`/`envelope` extension. Both `'historical'` and `'static'` liveness values are kept (they are genuinely distinct), and the surface union's "delayed implies a stated magnitude" safety property is ported onto the canonical type. Runs in parallel with Wave 2 because it only touches `surface/`, `discovery/`, `catalog/`, `webmcp/discovery/` — files no Wave 2 epic writes. |
| EPIC-1015: Legacy surface cutover | epic | **T-1015-1/T-1015-2 done 2026-09-02, verdict NO-GO — cutover paused, capability drops deferred (not closed)** | `epic/EPIC-1015-legacy-surface-cutover` | `docs/plan/EPIC-1015/retirement-inventory.md` and `capability-parity-matrix.md` committed (no deletion, no code changes — both audit-only). **Verdict: NO-GO**, two blockers: (1) a wiring gap — of ~33 target tools only 16 (14 panel + 2 results) are actually reachable in the running app, everything else is real/tested code dead behind `*_ENABLED = false` with no ticket owning the flip (this exact gap is now filed as issue #20, see below); (2) real capability losses confirmed against code — multi-step temporal pattern matching (new `TemporalCondition` is single-predicate only), `measure`/`split_instances` (no real counterpart; `backtest_screener` computes a differently-shaped walk-forward backtest), progressive tool availability, action-log attribution, workspace-status header, human-driven single-panel close, instance sampling/splitting/focus, `/dev` harness. One correction: the `render.yaml` health-check risk this epic's own doc named is already resolved (EPIC-0016 repointed it to `/health`). **User decision 2026-09-02: do not sign off on these drops as permanent — defer them (keep open as backlog), and prioritize a minimal working demo of the new panel/grid system over full cutover.** T-1015-3 onward stays paused; revisit once the demo (issue #20) is live and the drops have been reconsidered. |
| EPIC-0017: Engine correctness fixes (`within` bounds + `to_date` clamping) | fix | **merged to `main` (local merge, no PR, 2026-09-02), closes #17** | ~~`epic/EPIC-0017-engine-correctness-unvalidated-within-bo`~~ (merged; branch kept, worktree cleaned up) | **Done.** Single ticket (T-0017-1). Two bugs fixed in the legacy pattern engine (`backend/infra/pandas_engine.py`, `backend/domain/models/pattern.py`): unvalidated `within` bounds on non-anchor setup steps (now rejected at `Setup` construction naming the offending step/bounds), and completed instances whose non-anchor steps resolve after `to_date` (now clamped per-ticker via `_to_date_limit`, falling back to the existing "partial" path rather than a decisive match). 6-agent ticket review found 3 blocking findings (ticket-number-in-a-comment, a method over the 30-40 line guideline, a weak assertion a mutation check proved could hide a regression) — all fixed and re-verified before merge. 293/293 backend tests pass, no regressions. Scoping decision (interactive, this session): fixed now in the legacy engine rather than holding for EPIC-1015, since it's live until that epic actually retires it. Issue #17 closed manually (merged locally, no PR ran to auto-close it — same gap as EPIC-0013). |
| EPIC-0020: Wire the workbench composition root for a minimal live screener demo | epic | **merged to `main`** (squash, [PR #21](https://github.com/alekst23/webmcp-stock-screener/pull/21), merge commit `7d35f95`, 2026-09-03), closes #20 | ~~`epic/EPIC-0020-wire-workbench-composition-root`~~ (merged) | **Done: all 9 tickets** (3 core + 6 review follow-ups). Core: (1) a shared composition root for `/workbench` — one `WorkspaceRepository`/ID sequencer/idempotency cache/revision service/change history/`PinnedRunStore` instead of each tool group building its own — flipping `WORKBENCH_TOOLS_ENABLED` and `SCREENER_TOOLS_ENABLED` on; (2) auto-binding a completed screener run to the workspace's default `results_table` panel; (3) the first end-to-end integration test proving `create_screener` → ... → `run_screener` → visible in the panel, plus closing `docs/architecture/new-webmcp-surface.md`'s "composition root — currently unowned" gap. 5-agent epic review found 3 blocking findings (integration test didn't exercise the real entry point; silent error-swallow on auto-bind failure; epic's own AC/user-story didn't surface the known market-data-adapter limitation prominently) — all fixed and re-verified. Follow-ups T-0020-4 through T-0020-9 (multi-panel test, negative flag test, `FIXED_PROVENANCE` dedup + deps-split consistency, assertion-message quality, idempotency-replay+binding test, remount guard) also landed. **Known limitation, documented on the epic file:** this is a wiring gap, not a data gap — real production market data (EODHD-sourced, S3-backed) already exists and is served today by the deployed backend, and the legacy `/` page already reads it successfully via `src/lib/workspace/apiEngine.ts` → `/api/research/*`. What's missing is that the *new* screener engine's `ScreenerMarketData` port (`src/lib/screener/ports.ts`) has exactly one implementation anywhere in the codebase — `createUnavailableMarketData()`, a deliberate "not wired up" stub — so a live `run_screener` call is refused (`empty_universe`) rather than reading the backend that already has real data. This epic proves the composition-root wiring, not real data flow; connecting `ScreenerMarketData` to the existing `/api/research/*` endpoints is separate, not-yet-scoped work. CI independently re-verified twice before merge (not just the implementing agents' claims): 2929/2929 frontend tests, typecheck clean across 755 files, production build succeeds. `/workbench` is now live on `main` with the full composition wired — this is the MVP's core deliverable. |
| EPIC-0001: WebMCP Pattern Research Workbench | epic | paused | `epic/EPIC-0001-pattern-research-workbench` | 8/10 tickets done. T-0001-2 blocked (needs human + real WebMCP browser). T-0001-10 superseded by #14. **T-0001-9 is implemented, CI-green, and UNMERGED** on `feat/T-0001-9-real-data-pipeline` (`8448059`): EODHD backfill + nightly delta CLIs, R2 object store, universe metadata, `GET /api/research/panel`, and the compact `PanelFrame` (141 -> 25.1 B/row) EPIC-0013 builds on. ACs 1-4 done against recorded shapes; AC5 live run gated on EPIC-0013's T-0013-1/T-0013-2. |
| EPIC-0013: Market data storage | epic | **merged to main** (`08cc403`, local merge, no PR/gh record) | `epic/EPIC-0013-market-data-storage` | T-0013-1/2/3/5 landed and now on `main`; T-0013-6 still partial (blocked, needs paid backfill + deployed instance). Backend 99 tests pass (was 60). Measured: bulk load 63 B/row (was 1,560); nightly append ~0 MB on a 1.2M-row panel (was 1,980 MB); one-ticker read touches 0.9% of a 3M-row panel. Issue #13 is still **open** on GitHub despite the merge — no PR flow ran to auto-close it; needs manual close or a follow-up ticket-close pass. Reconciliation with EPIC-1008/EPIC-1011's OHLCV-bars port assumptions (Blockers table) is now live, not hypothetical, since real merged code exists to reconcile against. |
| hotfix/marketpane-rebrand | hotfix | **merged to `main`** (`1289b97`, 2026-09-02) | `hotfix/marketpane-rebrand` | Renamed the product to MarketPane, replaced the permanent synthetic-data banner with a header data-freshness pill, dropped the intro paragraph, and moved the ticker/universe search into a collapsed, expandable `TickerSearch.svelte` header control (parsing extracted to a shared `tickerSearch.ts` so the header control and ChartToolbar use one implementation). **The synthetic-data disclosure invariant is preserved**: a mock panel always renders as `state: 'synthetic'` with distinct treatment, never demoted to a plain stale warning; the old detailed sentence survives as the pill's tooltip. Mutation-checked — removing the synthetic short-circuit in `formatFreshness` failed exactly 2 tests, confirming they guard the invariant rather than restate it. typecheck 0 errors, 173 tests green on the branch, prettier clean, build succeeds. **Known consequence:** dropping the intro paragraph also removed the only nav link to `/dev`, which is now reachable only by direct URL — the spec required the unconditional removal, but a nav entry may be wanted. |
| EPIC-0016: AWS re-platform | epic | **merged to `main`** (`f49a06a`, 2026-09-02) — 10/13 tickets Done | `epic/EPIC-0016-aws-replatform` | All eleven `feat/T-0016-*` branches merged to the epic branch, then the epic merged to `main`. **Done:** T-0016-1 (Dockerfile, verified by a real `docker build`/`docker run`), T-0016-2 (health), T-0016-3 (object store on the credential chain), T-0016-4 (Terraform foundation — 17 resources applied live, clean second plan), T-0016-5 (EODHD key in SSM SecureString), T-0016-6 (App Runner service, deployed and verified), T-0016-7 (real EODHD backfill to S3, verified), T-0016-9 (container memory measured against the deployed image and the real panel), T-0016-12 (`REQUIRE_REAL_PANEL` guard), T-0016-13 (universe enforcement, verified live). Backend 148 tests pass (was 123). **Remaining three are production operations, not code:** T-0016-8 is implemented (`terraform/modules/nightly_job/`, EventBridge Scheduler -> ECS Fargate) but **never applied**, so none of its ACs are verified; T-0016-10 is the cutover; T-0016-11 (decommission Render) is user-gated. Ticket-doc statuses synced to reality in `d1bdc2b`. |

## Implementation wave order

Dependencies only — everything within a wave runs in parallel.

| Wave | Epics | Why sequenced here |
|------|-------|--------------------|
| W1 | EPIC-1006, EPIC-1008 | Independent foundations. 1006 owns the mutation contract; 1008 is read-only so it needs nothing from 1006. |
| W2 | EPIC-1007, EPIC-1009, EPIC-1011, EPIC-1013 | All consume 1006's contract; mutually independent. |
| W3 | EPIC-1010, EPIC-1012 | 1010 needs `run_id` from 1009; 1012 needs `capture_chart_setup` from 1011. |
| W4 | EPIC-1014, then EPIC-1015 | 1014 builds on all core epics. 1015 cutover is last and user-gated. |

## Backlog

1. **EPIC-0020 merged** — MVP's core deliverable (live screener demo wiring)
   is done, see Active Work/Completed. Next: decide what's actually next —
   a real `ScreenerMarketData` adapter connecting the new screener engine
   to the backend's already-live real data (so `run_screener` stops refusing
   every call), reconsidering EPIC-1015, or something else entirely. Needs
   a user decision, not automatic.
2. **EPIC-1015 cutover** — paused pending reconsideration of
   the capability drops the parity check found (see Active Work). **Do not
   resume T-1015-3 onward until the user confirms** (2026-09-01/09-02
   decision — explicit gate, not automatic). Prerequisites, all in the
   Blockers table: `get_canvas_state` can't see panel state (closed
   `PanelKind` union); custom studies have no chart-rendering path; the
   `render.yaml` health-check item is now resolved (see Active Work) and
   can be removed from Blockers.
2. (Deprioritized) EPIC-0001's remaining tickets: T-0001-2 (live verification,
   needs a human) and T-0001-9 (real data — implemented and CI-green on
   `feat/T-0001-9-real-data-pipeline`, unmerged; its AC1/AC5 live run is
   gated on EPIC-0013's T-0013-1/T-0013-2). T-0001-10 is superseded by #14.
3. (Low priority) The 9 follow-up tickets left by EPIC-0002/1003/1004/1005 —
   T-0002-4/5, T-0003-3/4, T-0004-2, T-0005-3/4/5.

## Blockers

| Blocker | Affects | Since | Action needed |
|---------|---------|-------|----------------|
| ~~**Two incompatible `provenance` contracts now coexist on `main`**~~ — **RESOLVED 2026-09-02** (`b0249ea`). One canonical `MarketDataProvenance` in `src/lib/workbench/domain/provenance.ts`: liveness keeps both `'historical'` and `'static'`; the record is a discriminated union on `liveness` so `'delayed'` cannot be stated without its magnitude; `sourceId` + `sourceLabel` replace the bare `source`; `reportingPeriod` (ReportingBasis) replaces `fundamentalsPeriod` (FiscalPeriod) because an FY/Q1-Q4 enum cannot express `trailing_twelve_months`; `currency`/`priceAdjustment`/`reportingPeriod` are genuinely optional and are omitted from the wire rather than emitted as null. `src/lib/surface/provenance.ts` is now only `DiscoveryEnvelope<T>` + `envelope()`. All four in-flight Wave 2 agents were messaged the new shape mid-run and told to merge `main` before consolidating. _Original entry kept below for the record:_ | EPIC-1009, EPIC-1011, EPIC-1012, EPIC-1013 (every epic that stamps provenance) | 2026-09-02 | Surfaced by actually merging EPIC-1006 and EPIC-1008 together — the exact "each epic invents its own copy" mistake the Decisions Log flagged once for `ids.ts`/`provenance.ts`. `src/lib/workbench/domain/provenance.ts` (EPIC-1006) defines `ProvenanceLiveness = 'live'|'delayed'|'end_of_day'|**'historical'**` with `MarketDataProvenance`/`withProvenance`/`toWireProvenance`; `src/lib/surface/provenance.ts` (EPIC-1008) defines `DeliveryStatus = 'live'|'delayed'|'end_of_day'|**'static'**` with `Provenance`/`makeProvenance`/`DiscoveryEnvelope`/`envelope`. Same concept, two vocabularies, differing in the fourth liveness value and in the envelope shape. **Not a build break** — nothing imports across the two yet, which is why 390/390 tests and typecheck pass — but it is a latent contract fork. EPIC-1006 owns the common contract per the program's own design, so `workbench/domain/` should win and `surface/provenance.ts` should be reduced to a discovery-specific extension of it. **Resolve before launching Wave 2**, or four more epics build against the ambiguity and multiply it. By contrast the two `ids.ts` are **not** a conflict: EPIC-1006's is the generic resource-ID mint/parse/sequencer, EPIC-1008's is instrument/catalog IDs — complementary, different concerns. |
| EPIC-0016's remaining tickets are all outward-facing production actions | EPIC-0016 T-0016-8, T-0016-10, T-0016-11 | 2026-09-02 | T-0016-8 (nightly EventBridge->Fargate job) is **implemented** — `terraform/modules/nightly_job/` exists and is merged to the epic branch — but unapplied and unverified against the live account. T-0016-10 is the production cutover and T-0016-11 (decommission Render) is explicitly user-gated. Applying Terraform to production and moving live traffic are hard-to-reverse actions outside what an autonomous loop should do unprompted. Needs the user to either run these or authorize the loop to. |
| Issues #17 and #14 are untriaged and cannot be triaged in loop mode | intake backlog | 2026-09-02 | `/at-issue-triage` runs an intent interview, which a background loop cannot conduct. **#17** (bug — engine correctness: unvalidated `within` bounds, and instances dated past `to_date`) is a real correctness defect in the current engine and is the higher priority of the two. **#14** (package the POC for public showing) is the former hackathon ticket. Run `/at-project-go` interactively, or `/at-issue-triage 17` directly, to clear these. |
| Reference/fundamental data (industries, indexes, countries, fundamentals, earnings calendars) has **no owner** | EPIC-1008, EPIC-1009, EPIC-1014 | 2026-09-01 | Was recorded as supplied by a "separate parallel workstream". User confirms no such work is defined — the quote behind it ("live data is being set up in another thread") meant T-0001-9 in this repo, not a separate human workstream. T-0001-9 supplies OHLCV plus sector and market cap (Nasdaq screener CSV) and nothing else on that list. Decide per data class: source it, drop the dependent capability, or have the port report it unavailable. Ports are already written, so this blocks end-to-end behavior, not epic work. |
| ~~`render.yaml:47` health-checks `/api/spike/ping`, a route EPIC-1015 plans to retire~~ — **RESOLVED**, confirmed 2026-09-02 by EPIC-1015's T-1015-1/T-1015-2 audit | EPIC-1015 | 2026-09-01 | EPIC-0016 already repointed `healthCheckPath` to `/health` (`backend/api/routes/health.py`) — verified directly against `render.yaml` during this session. The epic's own starting assumption was stale; no action needed. |
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

| ~~`defaultPanelKinds.ts`'s unconditional placeholder registration has no unregister/replace path in EPIC-1007's `PanelRegistry`~~ — **RESOLVED 2026-09-02** by EPIC-1010 (T-1010-7's agent). `panelKindRegistry.ts`/`sourceRendererRegistry.ts` now track which entries are placeholders and enforce one order-independent precedence rule: real registration always overwrites a placeholder, real-vs-real still conflicts (duplicate-registration safety net preserved), placeholder registration always skips if anything is present. Proven with bidirectional tests (real-then-default and default-then-real) at both the registry and composition-root level. EPIC-1012's local test-scoped workaround (superseded, not needed post-merge, but harmless to leave in place) is why this affected EPIC-1010/1011/1012 below. | EPIC-1007, EPIC-1010, EPIC-1011, EPIC-1012 (every epic registering a real panel kind) | 2026-09-02 | Found independently by EPIC-1012's agent while implementing T-1012-4/6/7/8.
| `get_canvas_state` (EPIC-1006) doesn't project panel state for any of EPIC-1007's panel kinds | EPIC-1007, EPIC-1010, EPIC-1011, EPIC-1012 | 2026-09-02 | EPIC-1006's `PanelKind` union is closed and `normalizeWorkspace` silently drops unknown kinds when projecting `doc.extensions['panel_system']` into `doc.panels`/`layout`/`links`. EPIC-1007 worked around it by keeping panel state in `extensions` rather than blocking on an EPIC-1006 change, but the read-model surface an agent would use to inspect the workspace still can't see panels. Needs the union opened (EPIC-1006 change) or a documented alternative read path. Not blocking Wave 2/3 since nothing downstream calls `get_canvas_state` for panel state yet, but must be resolved before EPIC-1015 cutover. |

| EPIC-1011's chart engine has no rendering path for custom studies (`study.custom.*`) | EPIC-1011, EPIC-1014 | 2026-09-02 | Found by EPIC-1014's T-1014-11 agent. `create_custom_study` (T-1014-2) validates, stores, and catalogs a custom study correctly, but there is no way to plot one on a chart — the chart engine only knows the built-in study catalog. A user/agent can author a custom study and never see it rendered. Needs an EPIC-1011 fast-follow: either the chart engine's study-rendering path consults the same catalog `create_custom_study` writes to, or a documented decision that custom studies are data-only (usable in screener conditions, computed fields, etc.) and never chart-rendered. |
| `ScreenerRun` pins a match/universe **count** but not the `UniverseSpec` itself | EPIC-1009, EPIC-1014 (export/backtest tools that read pinned runs) | 2026-09-02 | Found by EPIC-1014. A pinned run states how many instruments were in its universe but not which universe definition (watchlist, screener criteria, etc.) produced that count — so a run can't fully answer "what universe was this run over" from itself alone, only "how big was it." Minor relative to the retention/filterTree/rankingSpec pinning already done; worth a small follow-up if `export_results`/backtest provenance needs to state the universe definition, not just its size. |
| `ScreenerRun`'s per-instrument node-evaluation retention is ~80x worst-case storage under the default retention policy | EPIC-1009, EPIC-1010, EPIC-1014 (backtest/export tools that read pinned runs) | 2026-09-02 | EPIC-1010's T-1010-5 extension (retaining evaluations for every evaluated instrument, not just matches, so `explain_result` never falls back to a live re-read) is correct and approved, but the agent measured/flagged the worst-case multiplier. Retention policy is already pluggable (2026-09-01 working assumption: eviction is an explicit error, TTL unset) — this is a tuning question, not a design flaw. Not urgent; revisit if pinned-run memory becomes a measured problem, same trigger pattern as EPIC-0015's parked DuckDB work. |

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
| 2026-09-02 | **EPIC-1015's capability drops are deferred, not accepted** — user explicitly declined to sign off on them as permanent when asked; priority shifts to a minimal working demo of the new panel/grid system (issue #20) over full cutover | User: "Let's put them off, not close them off, and focus on an MVP set that can do something very simple that illustrates the grid system." Distinguishes this from a normal capability-parity sign-off — the drops (temporal patterns, measure/split, progressive availability, etc.) stay open questions to revisit, not decided losses. |
| 2026-09-02 | **Issue #17 (engine correctness) triaged and fixed in the legacy engine rather than held for EPIC-1015** | User decision when asked: the legacy pattern engine is live and user-facing until EPIC-1015 actually retires it, so a real correctness bug there is current risk, independent of the cutover's timeline. Corrected the `to_date` bug per the issue's own recommendation (a documented behavior change) rather than preserving it as a quirk. |
| 2026-09-02 | **User confirmed "Full cutover" for EPIC-1015** when asked to choose between full cutover / route-migration-only / visual-parity-first, satisfying the epic's own "must not launch until the user confirms in their own words" gate | User tested `main` locally (via the legacy page at `/`) and reported two things: no visible grid system, and "Failed to fetch" errors, then asked to "merge this into one app page" and "continue our refactor process to match the design" (pasted a reference mockup screenshot showing a full trading-terminal layout: screener logic panel, chart with pinned reference setup + studies, similar-setups sidebar, watchlist, alert-draft card, results table). Diagnosed first: the grid system exists and works, just on a separate un-navigated-to route (`/workbench`, EPIC-1007's own composition root, no feature flag); "Failed to fetch" was `.env`'s `PUBLIC_API_BASE_URL` pointing at the AWS production backend (set by the concurrent EPIC-0016 session) instead of `localhost:8000`, hitting a CORS block — fixed locally (`.env` is gitignored, not committed). The "merge into one page" ask is EPIC-1015 by another name; asked the user to confirm scope given the epic's explicit gate against autonomous launch, since it deletes the code the currently-deployed app runs on. Session was interrupted for `/at-project-sleep` before the epic was actually launched — see Active Work for what's queued. |
| 2026-09-02 | **EPIC-1006 through EPIC-1014 all merged to `main` in one `/at-project-go` run** (8 epics, ~59 tickets, plus the provenance contract unification) — the entire new WebMCP tool surface exists in new files, all still behind `false` feature flags | Per explicit user instruction ("implement epic-1007 through 1014, don't stop for PRs, merge all work to main") via `/loop`. Run in three sequential waves respecting real dependencies (1006/1008 already merged before this run; 1007/1009/1011/1013 parallel; 1010/1012 parallel once their contracts landed; 1014 last). All merges done directly by the orchestrator, never by delegate agents — with a second Claude session (`do 0016`) concurrently active in the same checkout, serializing merges through one point was the only safe way to honor "don't stop for PRs" without seven agents racing a moving `main`. `main` verified green after every single merge, not just at the end: 403 -> 553 -> 664/814 (rebase) -> 1113 -> 1524 -> 1884 -> 1973 -> 2195/2284 -> 2913 frontend tests, plus 198 -> 221 -> 289 backend tests, typecheck clean at every step. Several delegate agents hit an account-wide session rate limit mid-run (reset ~5:10am and again ~2:20pm ET) and were resumed with full context rather than restarted -- no work was lost across either interruption. Six real cross-epic contract gaps were found by delegate agents during implementation, each held for explicit orchestrator review before merging rather than self-approved (one delegate agent corrected its own overstated "already approved" language mid-run rather than letting it ride) -- all six approved and landed. Two documented, unfixed follow-ups remain for EPIC-1015 to pick up: no chart-rendering path for custom studies, and `get_canvas_state` can't see panel state. |
| 2026-09-02 | **EPIC-1010 extends already-merged EPIC-1009 code, again**: adds `filterTree` and `rankingSpec` fields to `ScreenerRun` (`src/lib/screener/run.ts`), pinning the actual filter-tree and ranking content onto the run object rather than relying on `screenerRevision` alone | `explain_result` needs the exact filter tree/ranking config that produced a run to build an explanation, and there is no wired-up revision-indexed store `ScreenerRun` could safely read the definition back from — an existing `main` comment on `run.ts` already flags that path as indirect/fragile. Pinning the content directly is more consistent with the pinned-run's own "never silently recomputed" guarantee than reaching into revision history would be. `toWireScreenerRun` deliberately excludes both fields (caller already has the data), so it's wire-invisible — no payload growth, no wire-compat surface. |
| 2026-09-02 | **EPIC-1010 extends already-merged EPIC-1007 code**: adds an optional `validateSelection?(input): {ok:true}\|{ok:false,errors}` field to `RendererTypeDefinition` (`src/lib/panels/registry/sourceRendererRegistry.ts`), consulted by `setPanelSelection.ts` before writing a selection | `setPanelSelection()` wrote any string array as a panel's selected IDs with zero validation, unlike its sibling `configurePanelView.ts` which already validates through the renderer registry. T-1010-6's AC6 ("an unknown result ID is rejected, previous selection unchanged") is unsatisfiable without this — the alternative was a results-specific side-channel duplicating `setPanelSelection`'s mutation logic, which risks the two ever disagreeing. Optional field means every existing renderer (`chart_grid` included) has zero behavior change. Mirrors the existing `validateRendererConfig` pattern exactly rather than inventing a new one. |
| 2026-09-02 | **EPIC-1010 extends already-merged EPIC-1009 code**: `evaluateUniverse`/`ScreenerRun` will retain `nodeEvaluations` for every evaluated instrument, not just matches | EPIC-1010's T-1010-3 agent found that EPIC-1009's engine only stored per-node evaluations for matched instruments (comment cited "AC12" but the actual text was T-1009-7 AC9, written before EPIC-1010's explain-rejected-candidates requirement existed). Explaining a rejected candidate would otherwise require a live re-read of `ScreenerMarketData`, which can disagree with the pinned run — exactly the "silent rerun with different numbers" the epic's core no-silent-rerun guarantee (AC3) forbids. Approved as additive/backward-compatible since EPIC-1009 is merged and not a concurrently active branch. Storage growth tradeoff (universe-bounded, not unbounded, but larger than match-only) to be quantified in T-1010-5's ticket doc so the already-pluggable retention/eviction policy can be tuned against a real number rather than discovered later. |
| 2026-09-02 | **Launched EPIC-1007/1009/1011/1013 in parallel with the design gate skipped**, rather than running `/at-ticket-design` + `/at-ticket-tests` for each of the 59 open tickets first | User instruction via `/loop`: "implement epic-1007 through 1014, don't stop for PRs, merge all work to main." `/at-epic-run`'s Step 3b pre-flight requires a `## Solution Approach` section and test stubs per ticket; **0 of 59 tickets across EPIC-1007/1009/1010/1011/1012/1013/1014 have either**, so the gate would have stopped all seven epics. The substantive design does exist — each epic has a complete `docs/design/<slug>/{spec,technical}.md` plus detailed per-ticket acceptance criteria — so the missing artifact is a per-ticket restatement, not the design itself. Traded for a hard requirement passed to every ticket agent: write the implementation plan into the ticket doc before coding, and no ticket is done without tests that fail without the implementation. **Note this differs from EPIC-1006/1008's precedent** (8/11 and 7/8 of their tickets did carry a Solution Approach), so this run is a deliberate loosening, and epic review at close is doing more of the quality work as a result. |
| 2026-09-02 | **Provenance contract fork resolved in favor of `src/lib/workbench/domain/provenance.ts`**, unified in parallel with Wave 2 rather than serially before it | The Blockers table required resolving this before Wave 2 "or four more epics build against the ambiguity and multiply it". Resolved both halves at once: the four Wave 2 agents were each told explicitly to import provenance only from `workbench/domain/` and never from `surface/provenance.ts`, which stops the fork from spreading immediately; and a fifth agent folds `surface/provenance.ts` into the canonical module. Safe to run concurrently because the unification only rewrites `surface/`, `discovery/`, `catalog/` and `webmcp/discovery/` — existing EPIC-1008 files that no Wave 2 epic writes to. Substantive calls handed to that agent: keep **both** `'historical'` and `'static'` (distinct concepts, neither should be silently dropped), keep an id **and** a human label for the source, and port the surface union's "delayed implies a stated delay magnitude" property onto the canonical record because it makes an unsafe state unrepresentable. |
| 2026-09-02 | Delegated agents consolidate onto their epic branch only; **the orchestrator does every merge to `main`** | The user asked not to stop for PRs, which removes the review gate but not the need for a single serializing point. A second Claude session (`do 0016`) is actively merging to `main` in this same checkout — seven agents merging concurrently into a moving `main` would be the worst possible shape. Agents are explicitly forbidden from pushing, opening PRs, or touching `main`; merges happen one at a time in the main session. |
| 2026-09-02 | **Concurrent session detected and coordinated with rather than worked around** | `main` moved from `06564f6` to `38031a6` (merges of EPIC-0016, `hotfix/marketpane-rebrand`, EPIC-0015 docs, EPIC-1007 spec updates) ~30 seconds into this run. Sent a cross-session message to `do 0016` claiming EPIC-1007-1014, their branches, and the provenance reconciliation, and disclaiming every `EPIC-0016`/`T-0016-*` branch and worktree. Every delegated agent carries the same do-not-touch list. |
| 2026-09-01 | **The production panel was unintentionally widened from 1,999 to 50,565 tickers**; universe scope reopened as a product decision | T-0016-8's idempotency proof required real nightly-delta runs, and the nightly path appends from EODHD's **bulk-by-exchange** endpoint, which returns the entire US exchange rather than the curated universe. Pre-existing, documented application behavior — not introduced by the ticket — but it silently discarded T-0016-7's deliberate ~$2.5B market-cap liquidity floor. Rows grew only +3.5% (2,338,597 → 2,420,825), so the panel size is fine; the problem is **match count**, which T-0016-9 established is what drives peak memory. The 1,999-ticker panel is recoverable (S3 version `JFyiAKWoGcEJLDOrjHCISd2p6Ue4kZ05`, 81,254,506 bytes). The live App Runner service is unaffected until it restarts — it holds its panel resident. User asked for a data-driven re-scope rather than a straight restore; analysis in `docs/reference/universe-scope-analysis.md`. |
| 2026-09-01 | **Universe floor should be median daily dollar volume, not market cap** | Recommended framing for the re-scope. Dollar volume measures what the product actually needs — whether a pattern is tradeable, and whether the OHLCV bars encode real market behavior rather than wide-spread microstructure noise. It is also computable from the panel itself, so it is self-maintaining and recomputed nightly, where a market-cap CSV is an external dependency that goes stale. Pair it with a price floor (sub-$5 names make percentage moves non-comparable) and a minimum-history floor (`trend200` needs 200 bars; a recent IPO yields NaN or garbage rather than an honest "insufficient data"). |
| 2026-09-01 | **Universe enforcement is missing at ingest and in the nightly job** | Whatever floor is chosen must be applied at ingest AND respected by the nightly delta, or the universe re-expands to the full exchange on the first real nightly run. This is why T-0016-8 correctly applied its EventBridge schedule **DISABLED** — Render's cron is still the live writer, and two writers to one panel would conflict. Enabling the schedule is gated on this fix, not just on cutover. |
| 2026-09-01 | **IAM role conventions differ between App Runner and ECS** — found live, twice | App Runner resolves task-definition secrets on the **instance/task** role; ECS resolves them on the **execution** role. Getting either wrong produces a failure with **no application logs** (App Runner: two `CREATE_FAILED` deploys; ECS: `TaskFailedToStart`). Also: `HeadBucket`, which `ensure_reachable()` calls, requires **`s3:ListBucket`**, not object-level permissions; and App Runner's secret resolution needs `ssm:GetParameters` (plural) plus `kms:DescribeKey`, not the singular forms. Three separate IAM gaps that only a live deploy surfaced. |
| 2026-09-01 | **Keep the App Runner instance at 2 GB** after measuring on the real deployed container | User decision, taken with the worst case in hand. Measured inside the actual image (`docker run --memory=2g --cpus=1`) against the real S3 panel, `ru_maxrss` with **no baseline subtraction**: realistic 3-step/4-study pattern **708.2 MB** (67% headroom); an unfiltered screen returning 1,225,899 matches **1,409.9 MB** (34% headroom). Nothing OOMs. The 1.41 GB figure sits right on the ~1.4 GB line the epic said should trigger a resize, and it excludes web-server and concurrency overhead — so the headroom is thin rather than comfortable. Accepted because it fits, the realistic pattern is well clear, and memory is a Terraform input: 3 GB is a one-line in-place update that does not change the hostname. **Revisit if concurrency or universe growth erodes it.** |
| 2026-09-01 | **Correction: peak memory is driven by MATCH COUNT, not expression complexity** | The project has been reasoning from a "+65% simple-to-complex" figure since 2026-09-01. That comparison was confounded — the two patterns differed in selectivity as well as complexity. Measured with a controlled pair on the deployed container, complexity costs **+12%**; the unfiltered pattern's 1.41 GB peak came from matching 1,225,899 instances. Consequence: a naive broad screen is the expensive case, not a sophisticated one, and **EPIC-0015's parked work should target result-set handling rather than expression evaluation** — its stated rationale (per-ticker chunked evaluation making peak independent of expression complexity) addresses the smaller of the two effects. Also fixed `measure_universe_scale.py`, which subtracted a post-import baseline and so reported numbers the container never sees. |
| 2026-09-01 | **EPIC-0015's un-park trigger becomes numeric: peak exceeds 70% of the configured ceiling** | Replaces the qualitative "when measured peak approaches its ceiling". Note this trigger is **already met on day one**: 1,409.9 MB is 70.5% of 2 GB. It is not treated as an emergency because that peak is an unfiltered worst case rather than the realistic pattern (708 MB, 35% of ceiling), but it means EPIC-0015 is a live consideration, not a distant one. |
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
| 2026-09-02 | Panel-system grid resolved to a fixed, non-scrolling 6-column x 4-row grid (24 cells), always exactly filling the viewport | User specified it explicitly via `/at-project-design`, closing spec Open Question 1 (previously "12-column, unbounded-row, row height a rendering concern"). Auto-placement can now genuinely fail once the grid is full — new scenario added rather than assumed away. |
| 2026-09-02 | New workspaces are seeded with a default `filter_builder`/`results_table`/`chart` layout instead of starting blank | User explicitly wanted a working layout on open, not an empty canvas. Owned entirely by EPIC-1007's composition root (T-1007-9) — no EPIC-1006 `create_workspace` change needed, since panels are EPIC-1007's domain. Not reachable through `apply_layout_template`; create-time-only, never re-applied on load/restore/duplicate. |
| 2026-09-02 | User overrode the recommended routing for the MarketPane rebrand + header cleanup: ran it as one hotfix despite it being cross-cutting (touches `terminal-ui-theme`'s shell and, at the UI-location level only, `pattern-research-workbench`'s search field), rather than filing an issue per the project's own "cross-cutting is never small" rule | Explicit user choice, made with the tradeoff stated plainly first. All of it turned out to be presentation-only — the underlying search *behavior* doesn't change, only where its UI control lives — which is why the actual spec delta landed entirely in `terminal-ui-theme/spec.md`. |
| 2026-09-02 | The "synthetic data" warning banner is being replaced by a header data-freshness pill, not kept as a permanent fixture | User confirmed the app now serves real market data by default (EPIC-0013/0016's pipeline is live) — the loud warning no longer matches the common case. The disclosure invariant itself ("mock must never read like real") is preserved defensively: the pill still carries a distinct treatment on the rare/dev-only occasion the panel is still mock, per `docs/design/terminal-ui-theme/spec.md`. |

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

## Last Run (2026-09-01, `/at-project-go` via `/loop`, argument "implement tool revision epics 1006 to 1012")

- **Trigger:** `/loop /at-project-go implement tool revision epics 1006 to
  1012` (dynamic/no-interval mode, autonomous — Steps 3b/5b skipped).
- **Assessment before acting:** `.claude/worktrees/agent-ab5c9b313859dd4b5`
  is a **live, locked, currently-running agent** (pid 41191, started
  18:10 today) actively implementing EPIC-1006's tickets on branch
  `t-1006-3-market-data-provenance` — 3 real commits (T-1006-2 mutation
  envelope, T-1006-3 provenance contract, a T-1006-1 reconciliation flag)
  plus uncommitted new domain files. Separately, two other long-running
  local `claude` CLI processes (pid 7557, pid 43367 — 23.5h CPU time) are
  active on this machine; their target repos/branches weren't
  investigated, out of caution against interfering. Per "respect
  in-flight work," **this run did not launch or touch EPIC-1006** — no
  duplicate `/at-epic-run EPIC-1006` was started.
- **Shipped:** Docs only — corrected the plan's stale claim that
  EPIC-1006 had "zero code" (it doesn't; see above), and re-verified
  EPIC-1008's PR #18 is fully ready (mergeable, clean merge-queue
  trial-merge, all gates the close pipeline checks already passed in an
  earlier session). Ran `/at-epic-close EPIC-1008` in-session; it found
  Steps 3-9 (CI, status updates, review, docs, PR) already complete on
  `origin/epic/EPIC-1008-discovery-and-catalog` (`2a677ef`) from a prior
  session my local clone hadn't fetched. The skill never merges to `main`
  itself, so no further automated action exists here — **PR #18 needs an
  explicit user merge decision**, not another pass of this skill.
- **Not launched, and why:** EPIC-1007/1009/1011/1012 (the rest of the
  1006-1012 range) all consume EPIC-1006's shared contract
  (`ids.ts`/`provenance.ts`/mutation envelope), which is only landing on
  a worktree branch right now, not on `main` or even the epic branch —
  starting them would either race the live EPIC-1006 agent's files or
  build against a contract that doesn't exist yet. Real dependency, not
  false caution.
- **In-flight at close:** The live EPIC-1006 agent (see above) — left
  running, not managed by this session.
- **Next run should:** Re-check whether the live EPIC-1006 agent
  (`.claude/worktrees/agent-ab5c9b313859dd4b5`) has finished or exited.
  If EPIC-1006's contract has landed (epic branch or `main`), launch
  EPIC-1007, EPIC-1009, and EPIC-1011 in parallel (Wave 2 of the 1006-1012
  range; EPIC-1012 waits on EPIC-1011's `capture_chart_setup`). If PR #18
  has been merged by the user, mark EPIC-1008 Completed in this plan.

## Last Run (2026-09-02, `/at-project-go` via `/loop`, continued — EPIC-1006 relaunch and close)

- **Trigger:** Continuation of the same `/loop /at-project-go implement
  tool revision epics 1006 to 1012` run — woken by the EPIC-1006 agent's
  own crashed-process finding from the previous tick.
- **Confirmed dead, relaunched:** The 2026-09-01 agent at
  `.claude/worktrees/agent-ab5c9b313859dd4b5` was confirmed crashed (pid
  41191 gone, worktree unlocked, no file activity in 6+ hours) rather than
  paused work. Relaunched EPIC-1006 fresh via a background `/at-epic-run`
  agent, which implemented all 8 tickets sequentially in one worktree
  (the skill's own parallel-worktree pattern hit a sandbox constraint) —
  9 commits, 235/235 tests, typecheck clean.
- **Ran the full close pipeline in-session:** CI (typecheck + 239 tests
  after fixes + prettier on touched files, all clean), merge-queue check
  (clean), a 5-agent `/at-epic-review` (5 parallel review agents covering
  conceptual soundness/intent, wiring, orchestration, architecture, best
  practices), triaged every finding, fixed the 3 critical ones directly on
  the epic branch, filed 3 follow-up tickets (T-1006-9/10/11) for the
  warning/nit findings, ran `/at-epic-docs` (new `docs/architecture/` tree
  — first doc tree on a branch that will actually merge, since EPIC-1008's
  own new architecture docs are still on an unmerged PR), then pushed and
  opened **PR #19**.
- **The 3 critical bugs fixed** (see EPIC-1006's Active Work row above for
  detail): `save_workspace` bypassing idempotency replay and change-history
  recording; change-history pruning silently never enforcing its documented
  cap; a swallowed storage-write failure that let the mutation envelope lie
  about success. All three were caught by *reading the actual code*, not
  inferred from ticket docs — exactly the failure mode whole-epic review
  exists to catch that per-ticket AC checks miss.
- **Deliberately did not merge either PR.** Both PR #18 (EPIC-1008) and PR
  #19 (EPIC-1006) are fully ready — CI green, review passed, mergeable,
  no conflicts with `main` individually. `/at-epic-close` never merges on
  its own by design, and merging is a shared-visibility, less-reversible
  action outside what an autonomous loop should do unprompted.
- **In-flight at close:** Nothing. The relaunch worktree
  (`.claude/worktrees/agent-a44143593a1888d8c`) is left in place (needed
  while PR #19 is open) but idle.
- **Next run should:** Check whether the user has merged PR #18 and/or
  #19. **This is now the real blocker for the rest of the 1006-1012
  range** — EPIC-1007/1009/1011/1012 all consume EPIC-1006's shared
  contract modules, which only exist on an unmerged branch; starting them
  before merge risks building against a contract that later changes, or
  each inventing its own copy (the exact mistake the Decisions Log already
  flagged once for EPIC-1006 vs. EPIC-1008's `ids.ts`/`provenance.ts`).
  Once both land on `main`, launch EPIC-1007, EPIC-1009, and EPIC-1011 in
  parallel. Note both PRs touch `docs/architecture/README.md` with
  different new content — expect a routine, easy conflict on whichever
  merges second.

## Last Run (2026-09-02, `/at-project-go` via `/loop`, argument "implement the work and merge to main, don't stop for PRs")

- **Merged both ready epics to `main`, unblocking the program.** PR #19
  (EPIC-1006) merged first as the foundation, then PR #18 (EPIC-1008),
  which absorbed the anticipated `docs/architecture/README.md` add/add
  conflict — resolved as a union of both epics' rows. Verified the first
  ever integration of the two epics before merging the second: **390/390
  tests pass, typecheck clean across 311 files.**
- **Found a real contract fork that only merging could reveal.** EPIC-1006
  and EPIC-1008 each shipped their own `provenance.ts` with incompatible
  vocabularies (`'historical'` vs `'static'` as the fourth liveness value,
  different envelope shapes). It is not a build break — nothing imports
  across them yet — but it is exactly the duplication the Decisions Log
  flagged once and it must be resolved before Wave 2, or four more epics
  build on the ambiguity. Recorded in Blockers. The two `ids.ts` are
  complementary, not duplicated.
- **Cleared two stale blockers.** Host disk is at 66 GB free with Docker
  healthy, and T-0016-1's Dockerfile is now verified by a real
  `docker build`/`docker run` — both blockers removed rather than carried.
- **Reassessed EPIC-0016, which was well ahead of what the plan recorded.**
  All eleven feature branches are merged to the epic branch (36 commits
  ahead of `main`); T-0016-1/2/3/4/5/6/7/9/12/13 are Done, several verified
  against the live AWS account. Only T-0016-8's apply, T-0016-10's cutover,
  and the user-gated T-0016-11 remain — all outward-facing production
  actions. Ticket-doc `**Status**` headers are stale for several of these.
- **Landed the design-doc reconciliation.** An agent swept all of
  `docs/design/` against `docs/reference/tool-spec.md`, fixed the three
  stale `select_result`/`edit_chart_studies` references, and confirmed no
  others exist. Merged to `main` (`b48874e`).
- **Stopped at the user's instruction ("stop after the PRs").** Wave 2
  (EPIC-1007, 1009, 1011, 1013) was NOT launched, though it is now
  unblocked.
- **Next run should:** first resolve the `provenance.ts` fork under
  EPIC-1006's ownership, then launch EPIC-1007/1009/1011/1013 in parallel.
  Issues #17 (a real engine-correctness bug) and #14 still need an
  interactive triage pass.

## Last Run (2026-09-02, `/at-project-go` via `/loop`, argument "implement epic-1007 through 1014. don't stop for PRs, merge all work to main")

- **The whole program landed.** Resolved the `provenance.ts` fork first
  (unified into `workbench/domain/provenance.ts`, `surface/provenance.ts`
  reduced to a thin `DiscoveryEnvelope` extension), then ran EPIC-1007,
  1009, 1011, 1013 in parallel, then 1010 and 1012 once their contracts
  landed, then 1014 last. All eight epics plus the provenance fix are now
  merged to `main`. `main` verified green after every merge: ended at
  2913/2913 frontend tests (748 files typecheck-clean), 289/289 backend
  tests — up from 399/311 at the start of this run.
- **Six real cross-epic contract gaps surfaced during implementation, all
  reviewed before merging, none self-approved.** Node-evaluation retention
  and pinned `filterTree`/`rankingSpec` on `ScreenerRun` (EPIC-1010 into
  EPIC-1009); an optional `validateSelection` hook and real prop-passing to
  panel-kind components (EPIC-1010 into EPIC-1007); a genuine
  order-independence bug in panel-kind/renderer registration that EPIC-1012
  had already hit and worked around — EPIC-1010 fixed the root cause,
  closing that blocker; four new `ResourceKind` values for EPIC-1014's
  backtest/export/computed-field/custom-study tools, where this run also
  caught and fixed an in-flight inconsistency (one ticket had worked around
  the same need locally instead of using the canonical extension).
- **Two account-wide session rate limits hit mid-run** (reset ~5:10am and
  ~2:20pm ET) killed several delegate agents. No work was lost either time
  — each had committed real progress before the failure, and was resumed
  with full context rather than restarted once the limit cleared.
- **Both of EPIC-1014's non-negotiable safety properties verified with
  adversarial tests**, not just asserted: no arbitrary code execution
  (smuggled SQL/JS rejected at every expression node, source-scanned for
  `eval`/dynamic `Function`), no silent alert arming (the full 13-tool
  surface swept including undo/replay/stale-revision paths, proving no
  sequence reaches `armed`) — which caught one real bug (undoing
  `disable_alert` could have re-armed an alert) before merge.
- **Coordinated with a second concurrently-active Claude session** (`do
  0016`, working EPIC-0016/AWS) rather than colliding with it — messaged it
  up front to claim EPIC-1007-1014's branches and disclaim EPIC-0016's, and
  it stayed off this program's files throughout.
- **New/updated blockers left for `/at-epic-review` or the next run before
  EPIC-1015 cutover:** `get_canvas_state` can't see panel state (closed
  `PanelKind` union in EPIC-1006); no chart-rendering path for custom
  studies (EPIC-1011 fast-follow); `ScreenerRun` doesn't pin `UniverseSpec`,
  only a count; `ScreenerRun`'s node-evaluation retention is ~80x
  worst-case storage under the default policy (tuning question, not
  urgent); the pre-existing `render.yaml` health-check and
  composition-root-wiring blockers from before this run are unchanged.
- **Next run should:** run `/at-epic-review` or a manual review pass across
  all eight merged epics before touching EPIC-1015 — this run's own
  delegate agents did real verification (tests, typecheck, targeted
  mutation checks) but nothing has done a holistic cross-epic architectural
  read since EPIC-1006/1008's 5-agent review. Then work the EPIC-1015
  prerequisite list above, in whatever order the user prefers, before
  requesting the explicit cutover approval EPIC-1015 is gated on.

## Last Run (2026-09-02, session closed via /at-project-sleep, "save state for next session")

- **Trigger:** User tested the previous run's output locally on `main`,
  reported two apparent problems, and — once diagnosed — asked to merge
  the new panel system into one page and continue refining toward a
  reference design mockup they shared.
- **Shipped:** Nothing new merged to `main` this segment (verification and
  diagnosis only). Confirmed `main`/`origin/main` are in sync at `4212aa2`
  and fully green (2913/2913 frontend tests across 748 typecheck-clean
  files, 289/289 backend tests) after the other session's push-then-abort
  event — no work was lost.
- **Scaffolded, not launched:** EPIC-1015 (legacy surface cutover) — user
  confirmed "full cutover" scope; orchestrator was about to dispatch
  `/at-epic-run EPIC-1015` when this closeout interrupted it. No branch,
  worktree, or code exists for it yet.
- **Filed:** Nothing new. No issues opened this segment.
- **Deferred:** None beyond EPIC-1015 itself (see above) and the long-
  standing EPIC-0016 user-gated production actions (T-0016-8 apply,
  T-0016-10 cutover, T-0016-11 decommission — untouched, not this
  session's scope).
- **In-flight at close:** Nothing. No agents were running, no CI in
  flight. Local dev server (`:5173`) and local backend (`:8000`) were
  both up and verified working during this segment; their state after
  the session ends is unknown (not this skill's concern).
- **Diagnosis worth preserving:** (1) the app has two live routes right
  now — `/` (legacy 11-tool surface, what the user's screenshot showed)
  and `/workbench` (EPIC-1007's new panel/grid system, un-flagged, fully
  functional) — testing the wrong one looks like "the feature isn't
  built." (2) Local `.env`'s `PUBLIC_API_BASE_URL` was pointed at the
  AWS production backend (apparently set by the concurrent EPIC-0016
  session for their own testing) instead of `localhost:8000`, which
  reads as "Failed to fetch" due to CORS — fixed locally (gitignored,
  not committed); flag to the other session if they need it back.
- **Next session should:** Launch EPIC-1015 with the "full cutover"
  scope the user already confirmed — `/at-epic-run EPIC-1015` (or
  `/at-project-go` again, which will pick this up from Active Work).
  Per the design-gate pattern used for EPIC-1007/1009/1011/1013, expect
  to authorize skipping the per-ticket design gate (0/8 tickets have a
  Solution Approach yet). Unlike every epic run this program has done so
  far, this one is **not purely additive** — T-1015-5/6 delete the
  legacy tool surface and workspace model — so hold for orchestrator
  review before those two waves specifically, not just report after the
  fact. Feed the delegate agent the design-parity context recorded in
  this entry's Active Work row (reference mockup's panel composition)
  so T-1015-2/T-1015-3 aim at real visual parity, not just minimum
  capability survival — the current default 3-panel seed is missing
  similar-setups, watchlist, and alert-draft panels the mockup shows.
