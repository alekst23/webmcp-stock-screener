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
