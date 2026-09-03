# T-1015-9: Build the new shared shell and consolidate the app onto one URL

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Design**: docs/design/legacy-surface-cutover/
**Status**: Open
**Depends on**: T-1015-3
**Blocks**: T-1015-6, T-1015-10, T-1015-12

## Description

T-1015-3 moves the app's rendering onto the new panel/workspace model,
but leaves two things unresolved: the new surface has no shared header
(product identity, data-freshness, WebMCP status) — it was built as a
standalone composition root, never wrapped in any shell — and the app
still runs on two separate routes. This ticket builds a new shell
component (not a reuse of the legacy page's `AppShell.svelte`, though it
follows the same established dark/dense visual language) and makes the
canonical app URL the one place the new surface renders, retiring the
interim second route as a separate surface.

## User Story

As a person opening the app after cutover,
I want one URL that shows the product's identity and status the way it
always has, wrapping the new panel grid,
so that the app reads as one coherent product, not an unbranded tool
surface next to the page I already knew.

## Acceptance Criteria

1. A new shell component renders product identity (name/logo), a
   data-freshness indicator, and WebMCP status (defined tool count,
   available tool count, bridge connection state) — the same information
   the legacy header showed, following the app's existing dark/dense
   visual language (per `docs/design/terminal-ui-theme/spec.md`), built
   as a new component rather than reusing the legacy `AppShell.svelte`.
2. The canonical app URL renders the new panel/workspace model wrapped
   in this shell.
3. The interim second route no longer exists as a separate surface —
   either it redirects to the canonical URL, or its content becomes the
   canonical URL's content and the old path is removed.
4. A production build succeeds and the app loads with no console errors
   on first paint, at the canonical URL.
5. No visual regression to the panel grid itself — the shell wraps it,
   it does not change panel rendering.

## Design References

- `docs/design/legacy-surface-cutover/spec.md` — "Route migration"
  scenarios: "One URL, one surface", "Shared shell".
- `docs/design/legacy-surface-cutover/technical.md` — shell reads
  WebMCP bridge/tool-registration state the same way the legacy header
  did.
- `docs/design/terminal-ui-theme/spec.md` — the visual language the new
  shell must follow.

## Out of Scope

Panel-close and action-log affordances inside the shell (T-1015-10).
Rich default layout content (T-1015-12). Deleting the legacy shell
component or legacy route's remaining files (T-1015-6).
