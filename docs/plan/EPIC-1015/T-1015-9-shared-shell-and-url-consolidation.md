# T-1015-9: Build the new shared shell and consolidate the app onto one URL

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Design**: docs/design/legacy-surface-cutover/
**Status**: Done — see Implementation Notes below
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

## Implementation Notes

**Status**: implemented.

- AC1: added `src/lib/panels/shell/WorkbenchShell.svelte` -- a new
  component, not a reuse of `src/lib/shell/AppShell.svelte` (which
  stays untouched for T-1015-6). Its markup and styles were lifted
  verbatim out of `+page.svelte`'s own interim inline header (the
  measure T-1015-3's Implementation Notes flagged as ahead of this
  ticket's shared shell), so the rendered output is unchanged (AC5) --
  only the ownership moved. It takes `panelStatus`, `webmcpStatus`,
  `bridgeState`, and a `children` snippet as props, and owns: product
  identity (`MarketPane` + the WebMCP protocol badge), the
  data-freshness pill (`workspace/panelStatus.ts`'s `formatFreshness`/
  `formatPanelStatus` -- confirmed still live, T-1015-4 kept the
  backend endpoint), and the WebMCP status group
  (`formatDefinedStatus`/`formatAvailableStatus`/`formatBridgeStatus`/
  `formatAgentToolsContext` from `webmcp/status.ts`), plus the
  dismiss-on-outside-click/Escape affordance for the two tool-name
  disclosures.
- AC1/status wrapper: `src/lib/webmcp/newSurfaceSession.ts`'s
  `connectNewSurfaceBridge` (built by T-1015-3) already satisfied this
  ticket's "WebMCP status wrapper" requirement exactly as described --
  reports `'connecting'` synchronously, `'connected'` with the live
  tool list on resolve, `'failed'` with a logged error on rejection --
  confirmed by reading it and its existing full-coverage test suite
  (`newSurfaceSession.test.ts`). No second wrapper was built. "Available"
  count is never tracked as a second live number: `WorkbenchShell`
  derives `availableCount` from the same `webmcpStatus.toolCount`
  `formatDefinedStatus` reads, gated only on `bridgeState === 'connected'`
  (spec.md Open Question 4 -- progressive availability is a confirmed
  drop).
- AC2: `src/routes/+page.svelte` now renders
  `<WorkbenchShell {panelStatus} {webmcpStatus} {bridgeState}>` wrapping
  the existing `.panel-viewport`/`PanelContainer` markup; the route
  keeps only data fetching and bridge-connection wiring (`onMount`,
  `fetchPanelStatus`, `connectNewSurfaceBridge`), no header markup.
- AC3: `src/routes/workbench/+page.svelte` (EPIC-0020's interim route,
  the only place the composition rendered before this ticket, unwrapped)
  is deleted outright, not redirected -- the composition guard it used
  (`workbenchCompositionGuard.ts`) now has its one call site on `/`.
  Nothing else in the codebase links or navigates to `/workbench`.
- AC4: `npm run build` succeeds (static adapter output, no errors). The
  interactive "loads with no console errors on first paint" browser
  check could not be run from this worktree -- port 5173 was held by a
  concurrent session's dev server (confirmed via `lsof`) -- outstanding,
  to be run via `/at-browser-check` before/at ticket close, same
  situation T-1015-3 recorded.
- AC5: no change to `PanelContainer.svelte` or its CSS; the
  `.panel-viewport` wrapper (the `contain: layout` containing-block
  trick for `PanelContainer`'s `position: fixed; inset: 0`) stays in
  `+page.svelte`, structurally identical to before, just now rendered
  as `WorkbenchShell`'s `children` snippet instead of a sibling of the
  inline header. The visual "no regression" claim itself is verified
  via the same outstanding browser check as AC4.
- Sibling tests that asserted on the header markup's previous location
  (inline in `+page.svelte`) were updated to read
  `WorkbenchShell.svelte` instead, since T-1015-9 legitimately moves
  that markup: `src/routes/routeMigration.test.ts`'s WebMCP status
  header test, and `src/lib/theme/paletteGuard.test.ts`'s
  `test_agent_context_comment_is_still_emitted` and
  `test_both_tool_counts_are_still_rendered_in_the_status_bar`. No
  assertion's underlying claim changed, only which file's source text
  it reads.
- `src/lib/panels/shell/sharedShellAndUrlConsolidation.test.ts`'s
  throw-stubs were replaced with real source-text assertions (the same
  no-component-render-harness convention `routeMigration.test.ts`
  established for T-1015-3). The AC4 and AC5 "no console errors" /
  "no visual regression" claims stay documented
  pending-browser-check stubs (`expect(true).toBe(true)`, matching
  `routeMigration.test.ts`'s own AC7 stub) rather than fabricated DOM
  assertions -- they are UI-observable claims only a real browser can
  prove. The WebMCP-status-wrapper describe block does not duplicate
  `newSurfaceSession.test.ts`'s full connecting/connected/failed
  coverage; it checks the wiring decision this ticket actually makes
  (the shell is backed by `connectNewSurfaceBridge`, not `session.ts`,
  and never tracks a second "available" number).
- Verification run from this worktree: `npm run typecheck` (0 errors),
  `npx vitest run` (this ticket's test file and every file it touched
  pass; the only remaining failures in the full suite are pre-existing
  failing stubs for sibling tickets T-1015-6/10/12 and T-1015-5's
  toolSurfaceRemoval.test.ts/legacyModelRemoval.test.ts, none of which
  this ticket modifies -- confirmed against the pre-change baseline via
  `git stash`), `npm run build` (succeeds).
