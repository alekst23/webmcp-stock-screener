# EPIC-1015: Legacy Surface Cutover

**Depends on**: EPIC-1006, EPIC-1007, EPIC-1008, EPIC-1009, EPIC-1010,
EPIC-1011, EPIC-1012, EPIC-1013, EPIC-1014
**Blocks**: —
**Design**: docs/design/legacy-surface-cutover/

> **GATED ON EXPLICIT USER APPROVAL.** This epic must not be launched until
> the user has confirmed, in their own words, that the new WebMCP surface
> built by EPIC-1006 through EPIC-1014 is good. It is the only epic in the
> program that deletes working, shipped code, and the currently-deployed
> hackathon submission runs on the surface it retires. `/at-epic-run
> EPIC-1015` is not a decision an autonomous run may make on its own.

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
| 1 | T-1015-1 | Retirement inventory and audit | — | Open |
| 2 | T-1015-2 | Capability-parity check (deletion gate) | T-1015-1 | Open |
| 3 | T-1015-3 | Migrate routes onto the new panel/workspace model | T-1015-2 | Open |
| 4 | T-1015-4 | Backend reconciliation | T-1015-2 | Open |
| 5 | T-1015-5 | Remove the legacy tool surface | T-1015-3 | Open |
| 6 | T-1015-6 | Remove the legacy workspace model and components | T-1015-5 | Open |
| 7 | T-1015-7 | Docs cutover | T-1015-4, T-1015-6 | Open |
| 8 | T-1015-8 | Deployment cutover verification | T-1015-7 | Open |

## Dependency Graph

```
T-1015-1 ──> T-1015-2 ──┬──> T-1015-3 ──> T-1015-5 ──> T-1015-6 ──┐
                        │                                         ├──> T-1015-7 ──> T-1015-8
                        └──> T-1015-4 ────────────────────────────┘
```

## Wave Plan

- **Wave 1**: T-1015-1 — no dependencies
- **Wave 2**: T-1015-2 — needs the inventory to check parity against
- **Wave 3** (parallel): T-1015-3 (frontend), T-1015-4 (backend) — disjoint
  file sets, both gated on the parity check
- **Wave 4**: T-1015-5 — the legacy tools can only go once nothing renders
  against them
- **Wave 5**: T-1015-6 — the legacy workspace model can only go once the
  tools that write to it are gone
- **Wave 6**: T-1015-7 — docs describe the post-deletion state
- **Wave 7**: T-1015-8 — verify the real deploy last

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

## Deployment risk

The currently-deployed hackathon submission runs on the legacy surface
(`docs/reference/deployment.md`). Two concrete hazards found during epic
authoring:

- `render.yaml` sets `healthCheckPath: "/api/spike/ping"`. That endpoint is
  served by `backend/api/routes/spike.py`, a T-1001-2 throwaway spike that
  is otherwise a retirement candidate. Deleting it without first repointing
  the health check will fail the Render deploy.
- `docs/reference/deployment.md` records the live verification evidence
  against legacy endpoints (`POST /api/research/find-instances`). Whatever
  survives reconciliation must be re-verified against the live deploy, not
  assumed.

Cutover therefore ends with an explicit live-deploy verification ticket
(T-1015-8), not with a green local CI run.

## Design References

- `.dev/design/tool-spec.md` — the ~33-core-tool target surface this program
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
specs derive from `.dev/design/tool-spec.md` and no design interview is
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
3. **Snapshots vs. workspace revisions.** EPIC-1005 shipped named
   `localStorage` snapshots; `tool-spec.md` specifies `save_workspace`,
   `undo_change`, `get_change_history`, and `restore_workspace_revision`.
   *Assumption*: the new revision model supersedes snapshots and the
   snapshot module is absorbed, not kept in parallel.
4. **The `/spike` route and `/api/spike/ping` endpoint.** Throwaway
   T-1001-2 scaffolding, but load-bearing for the Render health check.
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
