# T-1015-12: Enrich the default workspace layout to match the full target composition

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Design**: docs/design/legacy-surface-cutover/
**Status**: Open
**Depends on**: T-1015-9, T-1015-11
**Blocks**: T-1015-6

## Description

Today, a brand-new workspace is seeded with three panels: filter
builder, results table, and chart — a functional subset, not the
intended full composition. The user's own reference mockup shows a
richer default: the same three, plus a watchlist panel, an alert-draft
card, and a "Similar Setups" sidebar. Two of the three needed panel
kinds (watchlist, alert-draft) have no panel kind at all today — the
underlying tools shipped in EPIC-1014 but were never exposed as
something a panel can render. The third (`similar_opportunities`) is
already registered from EPIC-1012 and just needs including in the
default seed.

## User Story

As a person opening a brand-new workspace,
I want it to already look like the intended research terminal — not a
partial placeholder I have to build up myself,
so that the product's real shape is visible from the first load.

## Acceptance Criteria

1. Two new panel kinds exist: `watchlist` and `alert_draft`, each
   rendering the state EPIC-1014's underlying tools already produce
   (watchlist membership; a drafted alert pending review).
2. A brand-new workspace's default seed includes six panels: filter
   builder, results table, chart, watchlist, alert-draft, and
   similar-setups — laid out per the reference mockup's arrangement
   (screener logic left, chart with studies center, similar-setups
   sidebar right, watchlist and alert-draft bottom right, results table
   bottom).
3. `similar_opportunities` is included in the default seed using its
   existing registered panel kind — no new kind needed for it.
4. Each new panel kind is reachable through the shared workspace-read
   tool (depends on T-1015-11's fix).
5. A production build succeeds and a fresh workspace loads with all six
   panels rendering with no console errors, verified via browser check.

## Solution Approach

**Implements**: spec.md's "Rich default layout" scenario. Depends on
T-1015-9 (shell exists to host six panels) and T-1015-11 (read-path
widened, AC4).

**Approach**: frontend-only, three parts.

1. **Two new real panel kinds (AC1)**, following
   `results/registry/resultsTablePanelKind.ts`'s established template
   exactly — a `create<Kind>PanelKindDefinition(deps)` +
   `register<Kind>PanelKind(registry, deps)` pair, registered into the
   live registry *before* `registerDefaultPanelKinds()` so the real
   definition overwrites the placeholder (the registry's own `register()`
   already handles this precedence — "placeholder here + real ->
   overwritten by the real one" — no conflict, confirmed by reading
   `panelKindRegistry.ts`):
   - `watchlist` (new file, e.g.
     `workbench/watchlist/registry/watchlistPanelKind.ts`): renders
     `StaticWatchlist`/`DynamicWatchlist` membership from
     `workbench/watchlist/domain/watchlist.ts` (EPIC-1014, already
     stored under `doc.extensions`). `defaultPanelKinds.ts`'s existing
     placeholder `KindSpec` for `watchlist` already has the right
     `defaultSize`/`linkChannels`/`bindingTypes`/`configSchema` per the
     panel-system technical spec — reuse those, only replace
     `component()` and `validateConfig`.
   - `alert_draft` (new file, e.g.
     `workbench/alerts/registry/alertDraftPanelKind.ts`): renders the
     drafted alert from `workbench/alerts/domain/alert.ts`/
     `alertPreview.ts` (EPIC-1014). Note: `defaultPanelKinds.ts`'s
     placeholder list has a kind named `alerts` (plural), not
     `alert_draft` — this ticket registers a **new**, differently-named
     kind per AC1's own wording; it does not repurpose the `alerts`
     placeholder's spec. Confirm at implementation time whether `alerts`
     should retire as an unused placeholder or is separate future scope —
     out of scope to resolve here, just don't collide the two names.

2. **`similar_opportunities` (AC3)** — the *real* `PanelKindDefinition`
   already exists (`workbench/similarity/panel/domain/panelKind.ts`,
   T-1012-6), but as of this design pass is not registered into the
   shared `/workbench` composition's live registry — it is only ever
   registered into a standalone, disconnected `PanelRegistry` inside
   `registerSimilarityTools.ts`'s own composition root, which today never
   runs as part of `registerWorkbenchComposition()`. That module's header
   comment claims registering it alongside `registerDefaultPanelKinds()`
   "throws `PanelKindConflictError`" — reading `panelKindRegistry.ts`'s
   current `register()` shows that claim is **stale**: the placeholder/
   real precedence rule already resolves it cleanly, the same way
   `results_table`'s real registration already works today. T-1015-3 is
   the ticket that unifies the similarity tool group into the one shared
   composition (per its own Solution Approach, flipping
   `SIMILARITY_TOOLS_ENABLED`); **verify at implementation time that
   T-1015-3 already registered the real `similar_opportunities` kind into
   the shared registry** before assuming AC3's "no new kind needed" is
   free — if T-1015-3 left it on its own standalone registry, wiring it
   into the shared one is a precondition this ticket must do, not assume.

3. **Default seed (AC2)** — `panels/shell/panelController.ts`'s
   `DEFAULT_SEED_PANELS` (currently 3 entries) /`seedDefaultWorkspace`
   extend to 6, on the existing fixed 6-column x 4-row grid
   (`domain/grid.ts`'s `GridRect`/`GridSize` — the same grid
   `docs/plan/project.md`'s 2026-09-02 decision fixed). Exact coordinates
   per the reference mockup's arrangement (screener logic left, chart
   center, similar-setups sidebar right, watchlist + alert-draft bottom
   right, results table bottom) are an implementation-time layout
   decision bounded by each kind's `defaultSize`/`minSize`, not fixed
   here. AC4 (visible through the read path) falls out of T-1015-11's fix
   for free — no additional work in this ticket once T-1015-11 has
   landed first.

**Contracts to introduce**: none new Pydantic/Protocol-style contracts —
two new `PanelKindDefinition` values, using the type EPIC-1007 already
defines; not new contract types.

**Config vars introduced**: none.

**References**: `results/registry/resultsTablePanelKind.ts` (template),
`panels/registry/defaultPanelKinds.ts` (existing placeholder specs for
`watchlist`/`alerts`/`similar_opportunities`), `panels/registry/
panelKindRegistry.ts` (`register()`'s placeholder-precedence rule),
`panels/shell/panelController.ts` (`DEFAULT_SEED_PANELS`,
`seedDefaultWorkspace`), `workbench/watchlist/domain/watchlist.ts`,
`workbench/alerts/domain/alert.ts`, `workbench/similarity/panel/domain/
panelKind.ts`, `workbench/similarity/tools/registerSimilarityTools.ts`
(the standalone-registry finding above), `docs/design/
screener-followup-tools/spec.md`, `docs/design/similarity-search/spec.md`,
`docs/plan/project.md`'s reference-mockup arrangement note (2026-09-02).

## Design References

- `docs/design/legacy-surface-cutover/spec.md` — "Route migration"
  scenario: "Rich default layout".
- `docs/plan/project.md` — the reference mockup's described arrangement
  (recorded 2026-09-02).
- `docs/design/screener-followup-tools/spec.md` — EPIC-1014's
  watchlist/alert tool contracts, the data these new panel kinds render.
- `docs/design/similarity-search/spec.md` — `similar_opportunities`'s
  existing panel kind.

## Out of Scope

Changing what EPIC-1014's watchlist/alert tools do — this ticket only
gives them a panel kind to render in. Building the shell (T-1015-9) or
fixing the read-path blind spot (T-1015-11), both prerequisites.
