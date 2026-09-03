# EPIC-1015: Legacy Surface Cutover

**Depends on**: EPIC-1006, EPIC-1007, EPIC-1008, EPIC-1009, EPIC-1010,
EPIC-1011, EPIC-1012, EPIC-1013, EPIC-1014
**Blocks**: —
**Design**: docs/design/legacy-surface-cutover/

> **LAUNCH GATE CLEARED 2026-09-03.** The user confirmed the new surface is
> good and explicitly directed resuming this epic in full, including
> deciding the capability-parity drops T-1015-2's audit surfaced (see the
> Superseded note on T-1015-2, above). `/at-epic-run EPIC-1015` may now
> proceed. **The two deletion tickets (T-1015-5, T-1015-6) still need
> orchestrator review before merging** — this epic is not purely additive
> like EPIC-1007-1014 were, and deleting working, shipped code warrants a
> second look even with the launch gate cleared.
>
> **CLOSED 2026-09-03 with T-1015-8 and T-1015-13 open, per explicit user
> direction ("close it as is... we will finish implementation later").**
> 11 of 12 original tickets are Done; the code cutover, docs cutover, and
> local CI gate are complete. Two rounds of live testing during close
> surfaced and fixed real bugs beyond the original 12 tickets' scope:
>
> 1. **Chart panel integration fix** (commits after T-1015-7): the chart
>    panel kind's real implementation was never wired into the live panel
>    registry, its HTTP data adapter depended on a backend endpoint T-1015-4
>    had deleted without noticing, panel IDs could collide after a reload,
>    and the Broadcast UI silently no-op'd with no linked recipients.
> 2. **Second hardening pass** (commit `fcb0e14`): the epic's own review
>    (5-agent, see the review's findings folded into T-1015-14) and further
>    live testing found the identical unwired-shared-infra bug already fixed
>    for chart also existed in `registerSimilarityTools`/
>    `registerFollowupTools` (silent ID collisions, a re-opened
>    `get_canvas_state` blind spot, an invisible action log for that tool
>    group); a *third* instance of T-1015-4's endpoint-deletion regression
>    (`/api/research/panel`, the data-freshness endpoint); a defensive fix so
>    a persisted document corrupted by the ID-collision bug repairs itself on
>    read instead of crashing the panel grid; and a composition-guard/error-
>    state fix so a failed composition no longer strands the UI on
>    "Preparing workspace…" forever.
>
> **Concurrently, at the user's explicit direction, the tool surface was
> trimmed to a chart-only demo set** (`registerPanelTools` + chart +
> the new `resolve_ticker` tool) because the full ~39-tool surface was
> causing UI rejection issues (`workbenchCompositionRoot.ts`) — the
> workbench-core/screener/similarity/followup-authoring registration calls
> are commented out, not deleted, for a straightforward restore. **This
> means the app, as merged, does not currently meet this epic's own AC
> (full new surface reachable)** — that restoration is T-1015-13, tracked
> as a deliberate, explicit follow-up rather than blocking this close.
> T-1015-2's original capability-parity audit and T-1015-5/T-1015-6's
> deletions of the legacy surface remain valid and unaffected by the trim;
> only the depth of the new surface currently *registered* is reduced.

## Description

EPIC-1006 through EPIC-1014 build a new ~33-tool WebMCP surface (screener,
panels, charts, similarity, safety/preview, persistence) in **new files**,
alongside the existing 11-tool pattern-research workbench, so `main` stays
deployable throughout. This epic performs the retirement: it audits what
exists, proves every legacy capability has a new-surface equivalent or a
recorded deliberate drop, migrates the routes onto the new panel/workspace
model, deletes the legacy tool surface and workspace model, reconciles the
backend, and re-verifies the live deployment.

Done looks like: one tool surface in the codebase, no legacy product-surface
files left, no commented-out code, docs describing what actually ships, and
the deployed app working on the new surface.

## User Story

As the maintainer of this codebase after the new WebMCP surface lands,
I want the legacy 11-tool workbench surface removed in one deliberate,
audited cutover,
so that the project has a single coherent tool surface rather than two
overlapping ones, with no capability silently lost and no broken deploy.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1015-1 | Retirement inventory and audit | — | Done |
| 2 | T-1015-2 | Capability-parity check (deletion gate) | T-1015-1 | Done — verdict: NO-GO; superseded by user decision 2026-09-03 (see Decisions below) |
| 3 | T-1015-3 | Migrate routes onto the new panel/workspace model | T-1015-2 | Done |
| 4 | T-1015-4 | Backend reconciliation | T-1015-2 | Done |
| 5 | T-1015-5 | Remove the legacy tool surface | T-1015-3 | Done |
| 6 | T-1015-6 | Remove the legacy workspace model and components | T-1015-5, T-1015-9, T-1015-10, T-1015-12 | Done |
| 7 | T-1015-7 | Docs cutover | T-1015-4, T-1015-6 | Done |
| 8 | T-1015-8 | Deployment cutover verification | T-1015-7 | **Open — tracked follow-up, does not gate this PR** |
| 9 | T-1015-9 | Build the new shared shell and consolidate onto one URL | T-1015-3 | Done |
| 10 | T-1015-10 | Restore panel-close and action-log UI affordances | T-1015-9 | Done |
| 11 | T-1015-11 | Fix get_canvas_state's panel-state blind spot | — | Done |
| 12 | T-1015-12 | Enrich the default workspace layout | T-1015-9, T-1015-11 | Done |
| 13 | T-1015-13 | Restore the full new-surface tool registration | — | **Open — tracked follow-up, does not gate this PR** |
| 14 | T-1015-14 | Epic review follow-ups | — | **Open — tracked follow-up, does not gate this PR** |

**Superseded note (T-1015-2):** the NO-GO verdict stood on two blockers —
real capability drops and a composition-root wiring gap. The wiring gap
is now resolved (EPIC-0020, merged 2026-09-03). The capability drops were
individually re-confirmed with the user on 2026-09-03 (see Decisions Log
in `docs/plan/project.md` and the spec's now-resolved Open Questions) —
each accepted as a deliberate drop except three, which became new scope
(T-1015-9/10/11/12) rather than drops. The epic proceeds under this
updated verdict, not the original NO-GO.

## Dependency Graph

```
T-1015-1 ──> T-1015-2 ──┬──> T-1015-3 ──┬──> T-1015-5 ──> T-1015-6 ──┐
                        │               │                            ├──> T-1015-7 ──> T-1015-8
                        │               └──> T-1015-9 ──┬──> T-1015-10 ┘
                        │                                └──> T-1015-12 ┘
                        │                    T-1015-11 ──────────┘
                        └──> T-1015-4 ──────────────────────────────────┘
```

T-1015-11 has no dependency and can start any time; it only gates
T-1015-12 (which needs the read path fixed before adding panel kinds
that must be visible through it).

## Wave Plan

- **Wave 1**: T-1015-1 — no dependencies
- **Wave 2**: T-1015-2 — needs the inventory to check parity against
- **Wave 3** (parallel): T-1015-3 (frontend routes), T-1015-4 (backend),
  T-1015-11 (read-path fix, independent) — all gated on the parity check
  except T-1015-11, which has no dependency and can start immediately
- **Wave 4**: T-1015-9 — the new shell, once routes render the new model
- **Wave 5** (parallel): T-1015-5 (tool removal, needs routes migrated),
  T-1015-10 (panel-close/action-log, needs the shell), T-1015-12 (rich
  layout, needs the shell and the read-path fix)
- **Wave 6**: T-1015-6 — the legacy workspace model and its components
  (including the legacy shell) can only go once every new-surface
  replacement (T-1015-5, T-1015-9, T-1015-10, T-1015-12) has landed
- **Wave 7**: T-1015-7 — docs describe the post-deletion state
- **Wave 8**: T-1015-8 — verify the real deploy last

## Acceptance Criteria

1. A file-level inventory exists that classifies every legacy artifact as
   **retire**, **keep** (infrastructure, not product surface), or **absorb**
   (logic moved into the new surface), with a one-line reason for each.
2. Every capability the legacy surface offered is either mapped to a
   named new-surface tool or recorded as a deliberate, user-visible drop —
   and this mapping is complete *before* any deletion happens.
3. No route in the app renders the legacy workspace model; every route in
   `src/routes/` runs on the new panel/workspace model.
4. The 11 legacy tools (`defineStudy`, `defineSetup`, `findInstances`,
   `sampleInstances`, `measure`, `splitInstances`, `showGrid`,
   `showTickerCharts`, `clearPanels`, `focusInstance`, `getWorkspace`) are
   absent from the registered tool surface and from the codebase.
5. Retirement is deletion, not commenting out: no commented-out code, no
   unused imports, no unreachable branches, and no vestigial exports remain
   from the removed surface (project Dead Code Policy).
6. The WebMCP transport layer (bridge, registration/diffing, session state
   machine, status formatting) survives the cutover and continues to serve
   the new tool surface, with its tests still passing.
7. Backend modules that no longer serve any surface are deleted; modules
   that serve the new surface remain, with their tests passing.
8. `README.md`, `docs/tools.md`, `docs/design/`, and `docs/reference/`
   describe the shipped surface, with no references to removed tools,
   files, routes, or endpoints.
9. The full CI gate passes on the epic branch: typecheck, lint, format,
   frontend tests, backend tests, and a production build.
10. The deployed app (Render backend + Cloudflare Workers frontend) is
    verified working on the new surface after cutover, including its
    health check and CORS configuration.
11. The app converges onto one canonical URL, wrapped in a newly-built
    shared shell (product identity, freshness, WebMCP status) following
    the established visual language — not a reuse of the legacy shell
    component.
12. A human can close a panel by hand, and can expand a compact header
    icon to see the human/agent-attributed action log.
13. The shared workspace-read tool sees every registered panel kind, not
    a fixed closed set defined when the read model was first built.
14. A brand-new workspace is seeded with the full intended composition
    (filter, results, chart, watchlist, alert-draft, similar-setups), not
    a 3-panel placeholder.
15. Every capability confirmed as a deliberate drop (multi-step temporal
    matching, measure/splitInstances, progressive tool availability,
    instance sampling, the manual tool-harness route) is documented as
    such in the cutover docs (T-1015-7) — not silently absent.

## Deployment risk

The currently-deployed hackathon submission runs on the legacy surface
(`docs/reference/deployment.md`). Two concrete hazards found during epic
authoring:

- `render.yaml` sets `healthCheckPath: "/api/spike/ping"`. That endpoint is
  served by `backend/api/routes/spike.py`, a T-0001-2 throwaway spike that
  is otherwise a retirement candidate. Deleting it without first repointing
  the health check will fail the Render deploy.
- `docs/reference/deployment.md` records the live verification evidence
  against legacy endpoints (`POST /api/research/find-instances`). Whatever
  survives reconciliation must be re-verified against the live deploy, not
  assumed.

Cutover therefore ends with an explicit live-deploy verification ticket
(T-1015-8), not with a green local CI run.

## Design References

- `docs/reference/tool-spec.md` — the ~33-core-tool target surface this program
  builds toward, and the source of truth all specs derive from. Note: this
  file is **not tracked in git**; it lives only in the main working copy.
- `docs/design/pattern-research-workbench/spec.md` — the legacy product
  spec being retired; its Behavioral Specifications section is the
  authoritative list of legacy capabilities for the parity check.
- `docs/design/pattern-research-workbench/technical.md` — the legacy
  contracts; the sections on `WebmcpStatus`, `WebmcpConnection` lifecycle,
  and `startBridgeSession` cover the transport layer that is being kept.
- `docs/design/workspace-snapshots/spec.md` — snapshots, superseded by
  `save_workspace` / `restore_workspace_revision` in the new surface.
- `docs/tools.md` — the legacy tool surface's own documentation.
- `docs/reference/deployment.md`, `render.yaml`, `wrangler.jsonc` — the
  live deployment this cutover must not break.
- The `_epic.md` and design docs of EPIC-1006 through EPIC-1014 — the
  authoritative record of what the new surface actually delivered, which
  the parity check must be built against rather than assumed from
  `tool-spec.md`.

## Open Questions

Recorded rather than resolved, per the program's standing decision that
specs derive from `docs/reference/tool-spec.md` and no design interview is
run. Each carries a stated assumption so the epic can proceed.

1. **The event-atom research model has no obvious home in the new surface.**
   `tool-spec.md` describes a screener over instruments; the legacy surface
   is a workbench over `(ticker, date)` events. The closest new-surface
   analogues are `edit_filter_tree`'s Temporal and Pattern condition types,
   `capture_chart_setup`, and `find_similar_setups`.
   *Assumption*: setup definition and instance search are absorbed by
   `edit_filter_tree` + `run_screener`. T-1015-2 must confirm this against
   what EPIC-1006-1014 actually built.
2. **`measure` and `splitInstances` have no core-tool equivalent.** Their
   nearest match is `backtest_screener` / `get_backtest_results`, which
   `tool-spec.md` lists under *high-value follow-up tools*, not core.
   *Assumption*: if those follow-ups did not ship, statistical outcome
   measurement and winner/loser splitting are a **deliberate capability
   drop** that must be surfaced to the user for sign-off in T-1015-2,
   not silently deleted.
3. **Snapshots vs. workspace revisions.** EPIC-0005 shipped named
   `localStorage` snapshots; `tool-spec.md` specifies `save_workspace`,
   `undo_change`, `get_change_history`, and `restore_workspace_revision`.
   *Assumption*: the new revision model supersedes snapshots and the
   snapshot module is absorbed, not kept in parallel.
4. **The `/spike` route and `/api/spike/ping` endpoint.** Throwaway
   T-0001-2 scaffolding, but load-bearing for the Render health check.
   *Assumption*: retire both, after repointing `healthCheckPath` at a
   real health endpoint on the new surface (T-1015-4).
5. **Ownership of each new tool by epic is unknown at authoring time**,
   since EPIC-1006 through EPIC-1014 are being planned concurrently.
   *Assumption*: T-1015-1 and T-1015-2 read the sibling epics' plan docs
   and the actual merged code, and treat `tool-spec.md` as intent, not
   as a record of what shipped.

## Out of Scope

- Building any part of the new surface — that is EPIC-1006 through
  EPIC-1014. This epic only removes and re-points.
- Adding capabilities that neither surface has.
- Re-litigating the full-replacement decision, or a gradual dual-surface
  coexistence mode. The standing decision is one cutover at the end.
- Data migration of users' existing `localStorage` workspaces or
  snapshots into the new revision model. If the new surface needs a
  migration path, it belongs to the epic that owns persistence.
- Performance work, new deployment targets, or re-platforming.
