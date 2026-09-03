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

## Solution Approach

**Implements**: spec.md's "Route migration" scenarios "One URL, one
surface", "Shared shell", "Status header".

**Approach**: frontend-only, builds on T-1015-3 having made the canonical
route (`src/routes/+page.svelte`) render the new panel/workspace
composition (`registerWorkbenchComposition()` / `PanelContainer`) instead
of the legacy store. Two genuinely separate pieces of work:

1. **New shell component** — `src/lib/panels/shell/WorkbenchShell.svelte`
   (new file; not `src/lib/shell/AppShell.svelte`, which stays untouched
   until T-1015-6 deletes it). Wraps `PanelContainer` with a header
   showing product identity (same name the legacy `<h1>` uses today —
   "MarketPane" — new markup, not imported), a data-freshness indicator
   (reuse `workspace/panelStatus.ts`'s `fetchPanelStatus`/`formatFreshness`
   if T-1015-4 keeps that backend endpoint; re-verify at implementation
   time since T-1015-4 is separate, in-flight scope), and WebMCP status
   (below). Follows `docs/design/terminal-ui-theme/spec.md`'s dark/dense
   visual language; AC1 explicitly rules out reusing `AppShell.svelte`.

2. **WebMCP status is new plumbing, not a re-point** — `webmcp/session.ts`'s
   `startBridgeSession` and `webmcp/register.ts`'s `connectWebmcp`/`connect`
   are hard-wired to the legacy `ResearchEngine` and internally call
   `buildTools(engine)` (the 11-tool builder); they cannot register the new
   surface's tool groups, each of which (`registerPanelTools`,
   `registerWorkbenchTools`, `registerScreenerTools`, ...) calls
   `ensureModelContext()` and `mc.registerTool()` directly with no unified
   connect/dispose/generation-tracking wrapper and no reported connection
   state at all today. Only `webmcp/bridge.ts` (`ensureModelContext`,
   `onBridgeReplaced`) and `webmcp/status.ts` (`WebmcpBridgeState`,
   `formatDefinedStatus`, `formatAvailableStatus`, `formatBridgeStatus`,
   `buildWebmcpStatus`) are the actually-generic, kept transport pieces —
   confirmed by reading both modules; `docs/design/legacy-surface-cutover/
   technical.md`'s "reads the same way the legacy header did" describes the
   *formatters and type*, not the connection wrapper. Build a small new
   status wrapper around whichever function T-1015-3 leaves as the route's
   composition entry point (`registerWorkbenchComposition()` today) that
   reports `'connecting'` before that awaited call, `'connected'` once it
   resolves, `'failed'` if it throws — mirroring `session.ts`'s state
   semantics without reusing its `ResearchEngine`-shaped body. "Defined"
   tool count is the total `ToolSpec` count across every group the
   composition registers; since progressive tool availability is a
   confirmed drop (spec.md Open Question 4 — every group registers
   statically, nothing unlocks later), "available" always equals
   "defined" — call `formatAvailableStatus` with that same count rather
   than tracking a second live number.

3. **Route consolidation (AC3)** — once `/` renders this shell, `/workbench`
   (EPIC-0020's interim route, currently the *only* place the new
   composition renders, unwrapped) stops being a separate surface: either
   delete `src/routes/workbench/+page.svelte` outright, or replace it with
   a redirect to `/`, whichever leaves no route rendering the composition
   twice. Check `src/routes/routeMigration.test.ts` (T-1015-3's stub) and
   whatever T-1015-3 actually implemented before choosing, since T-1015-3
   lands first and may have already settled this.

**Contracts to introduce**: none new domain models/Protocols (TS project,
no Pydantic/Protocol layer here). The status wrapper's return shape (e.g.
`{ state: WebmcpBridgeState; toolCount: number }`) is a plain local
interface, not a shared domain contract.

**Config vars introduced**: none.

**References**: `docs/design/terminal-ui-theme/spec.md`,
`src/lib/webmcp/status.ts`, `src/lib/webmcp/bridge.ts`,
`src/lib/webmcp/session.ts` and `register.ts` (pattern reference only —
not directly reusable), `src/lib/panels/shell/registerPanelTools.ts`,
`src/lib/workbench/composition/workbenchCompositionRoot.ts`,
`workbenchCompositionGuard.ts`, `src/routes/workbench/+page.svelte`,
`src/lib/shell/AppShell.svelte` (visual-language reference only, not
reused as code), `src/lib/workspace/panelStatus.ts`.

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
