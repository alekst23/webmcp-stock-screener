# T-1015-5: Remove the legacy tool surface

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Status**: Done
**Depends on**: T-1015-3
**Blocks**: T-1015-6

## Description

With no route rendering against them, the 11 legacy tools can go. This
ticket deletes the legacy tool definitions, their registration wiring,
their type contracts, and their tests — while leaving the WebMCP
transport layer intact and serving the new surface.

The delicate part is that the legacy product types and the WebMCP
ambient transport types currently share one module. Retirement means
separating them, not deleting the file.

## User Story

As an agent connecting to the app after cutover,
I want exactly one tool surface offered to me,
so that I am not choosing between two overlapping vocabularies for the
same product.

## Acceptance Criteria

1. None of the eleven legacy tools — `defineStudy`, `defineSetup`,
   `findInstances`, `sampleInstances`, `measure`, `splitInstances`,
   `showGrid`, `showTickerCharts`, `clearPanels`, `focusInstance`,
   `getWorkspace` — is registered with the bridge, and none appears in
   the codebase.
2. Legacy product-surface type contracts (the workspace state model, the
   per-tool input types, the legacy engine interface, the legacy
   expression-error carrier and function catalog) are removed.
3. The WebMCP transport types the bridge and registration layers depend
   on survive the removal and remain importable.
4. The bridge, registration/diffing, session state machine, and status
   modules survive and continue to serve the new tool surface; their
   tests pass without being weakened or skipped.
5. The registration layer no longer depends on the legacy tool builder or
   the legacy engine interface.
6. Tests that existed only to cover legacy tools are deleted rather than
   left skipped, and no surviving test asserts on a removed tool name.
7. Typecheck, lint, and the full frontend test suite pass.
8. No commented-out code, unused imports, unused exports, or unreachable
   branches remain in the touched modules.

## Design References

- `docs/plan/EPIC-1015/` — T-1015-1's inventory names precisely which
  symbols in the shared type module are transport versus product.
- `docs/design/pattern-research-workbench/technical.md` — the
  `WebmcpConnection` lifecycle, `startBridgeSession`, and status-header
  sections document the behavior the surviving transport must preserve,
  including remount ownership and the connect-failure path. These are
  the regressions to watch for.
- `docs/tools.md` — the legacy surface being removed.

## Technical Considerations

The registration layer's remount-generation ownership and its
best-effort dispose semantics were the subject of an earlier bug fix:
a slow-resolving old mount must not unregister names a newer mount has
claimed, and a bridge without an unregister capability must not report a
teardown that did not happen. Whatever re-pointing happens here must not
regress that; its tests are the guard.

The registration layer also feeds an activity log on every tool call.
Whether that survives depends on T-1015-2's verdict; if it does, the
legacy per-tool result summarizer is superseded by the new surface's
own change-summary contract and should not be carried across.

Removing the legacy tool surface will break the legacy engine client and
the legacy workspace store, which is expected — they are removed in
T-1015-6. Sequence the work so the branch is green at the end of this
ticket, not so each intermediate commit is.

## Solution Approach

**Implements**: the "Tool-surface removal" scenarios in spec.md (happy
path, shared module, transport preserved, legacy-only test).

**Approach**: frontend-only, gated on T-1015-3 (no route renders against
the legacy tools any more). Split `src/lib/webmcp/types.ts` at the symbol
level per T-1015-1's inventory: the transport slice (`ModelContext`,
`ModelContextToolDescriptor`, `ToolResult`, `ToolSpec`, the ambient
`declare global` block) survives; the product slice (`StudySummary`,
`SetupStep`, `SetupSummary`, `InstanceEvent`, `InstanceSetSummary`,
`PanelSummary`, `FocusState`, `WorkspaceState`, every `*Input`/`*Result`
type, `ResearchEngine`, `FUNCTION_CATALOG`, `ExpressionError`) is deleted.
Before deleting `tools.ts`, extract its `ok()`/`fail()` `ToolResult`
constructors to a small transport-side module (e.g. `webmcp/
toolResult.ts`) — the inventory found 19 new-surface files import them
today, so deleting `tools.ts` wholesale would break those builds; this is
a mandatory extraction, not a plain retire. Delete `tools.ts`,
`tools.test.ts`, `spike.ts`, `spike.test.ts`, `integration.test.ts`.
`register.ts`, `session.ts`, `status.ts` and their tests were classified
"absorb, contingent" in the inventory: keep and re-point them only if
T-1015-3 or a sign-off decision actually reused `register.ts`'s
desired-vs-registered diffing or `session.ts`'s bridge state machine for
something live on the new surface; if nothing does (progressive
availability was an accepted drop per T-1015-2), downgrade them to retire
here rather than leaving unused code behind — this ticket makes that call
concrete by checking what T-1015-3 actually wired. Whichever way that
lands, `register.ts` must not import `buildTools`/`ResearchEngine`
directly any more (AC5); if kept, it takes a `ToolSpec[]` and an engine as
parameters instead. The registration layer's remount-generation ownership
and best-effort dispose semantics (the earlier T-1006 bug fix) must not
regress — its existing tests are the guard and must keep passing
unweakened (AC4). The legacy per-tool result summarizer (`activity.ts`'s
`summarizeToolCall`) is not carried across regardless — the action log's
attribution replacement is T-1015-10's scope, not this ticket's, and
`activity.ts` itself does not retire until T-1015-6.

**Contracts to introduce**: none — this ticket deletes contracts, it does
not add any. Moving the transport types or extracting `ok`/`fail` is a
file move, not a new contract.

**Config vars introduced**: none.

**References**: `docs/plan/EPIC-1015/retirement-inventory.md` §2-3 (which
symbols in `types.ts`/`tools.ts` are transport vs. product, and the
mandatory `ok`/`fail` extraction), `docs/design/pattern-research-
workbench/technical.md` (`WebmcpConnection` lifecycle, `startBridgeSession`,
status-header sections), `docs/tools.md`.

## Out of Scope

The legacy workspace store, engine client, and Svelte components
(T-1015-6). Backend changes (T-1015-4). Doc updates (T-1015-7).

## Implementation Note (post-hoc, on close)

Two calls this ticket had to make concretely rather than leave contingent:

1. **`register.ts`/`session.ts` retired, not re-pointed.** Reading
   `newSurfaceSession.ts` (T-1015-3) directly confirms it does not reuse
   `register.ts`'s `connectWebmcp` diffing or `session.ts`'s
   `startBridgeSession` state machine -- both are `ResearchEngine`-shaped,
   and T-1015-3's own comment explains why they could not be reused as-is
   (per-tool progressive availability, which the capability-parity check
   found is a structural drop for the new surface: every tool group
   registers unconditionally in one pass). With zero live callers left,
   `register.ts`, `register.test.ts`, `session.ts`, `session.test.ts`, and
   `webmcp/testSupport.ts`'s `FakeBridge`/`fakeBridge` (used only by those
   two test files) retired here rather than being kept unused.
   `bridge.ts`/`status.ts` do have real, current importers on the new
   surface and survive; `webmcp/testSupport.ts`'s `clearModelContext` also
   survives (`newSurfaceSession.test.ts` uses it). register.test.ts's
   bridge-relevant coverage (ensureModelContext's page-bridge install,
   onBridgeReplaced, and the same-document relay) was extracted into a new
   `bridge.test.ts`, rewritten against `bridge.ts` directly with no
   dependency on the legacy engine, so that coverage is not lost (AC4).

2. **The AC2 type deletion cascaded into `workspace/`, ahead of T-1015-6.**
   `WorkspaceState`/`ResearchEngine` (AC2's required deletions) turned out to
   be imported directly by `workspace/store.ts`, `apiEngine.ts`,
   `snapshots.ts`, `snapshotGuard.ts`, and by `WorkspaceView.svelte`,
   `GridPanel.svelte`, `PriceChart.svelte`, `FocusChart.svelte`,
   `ChartToolbar.svelte`, `SnapshotPicker.svelte` (directly or transitively
   via `store.ts`/`apiEngine.ts`). None of these had a live importer left --
   `+page.svelte` (T-1015-3/T-1015-9) no longer references any of them, and
   `SnapshotPicker.svelte`'s snapshot capability was already unreachable
   (`WORKBENCH_TOOLS_ENABLED = false`, so its would-be replacement,
   `revisionService.ts`, is not live either). Since this ticket's AC2 cannot
   be satisfied without breaking their compilation, and AC7 requires
   typecheck/lint/the full suite to pass at the end of this ticket (the
   Technical Considerations section anticipates exactly this: "will break
   the legacy engine client and the legacy workspace store, which is
   expected... sequence the work so the branch is green at the end of this
   ticket"), those ten files and their tests were deleted here rather than
   left broken for T-1015-6. `ActivityFeed.svelte` (imports only
   `activity.ts`, which survives) and `TickerSearch.svelte`/`tickerSearch.ts`
   (no product-type dependency) were left alone -- they still compile and
   are genuinely T-1015-6's call. `panelStatus.ts`'s `ApiClientConfig`
   import (still live: `+page.svelte` calls `fetchPanelStatus`) was replaced
   with a local, narrowed interface (`{ baseUrl: string }`) rather than
   deleted, since `apiEngine.ts`'s unused `instanceSetStorage` field was the
   only reason it needed the wider shape.

   **T-1015-6 should re-read its own Solution Approach against this before
   starting** -- its "delete store.ts, apiEngine.ts, and their tests" and
   most of its AC1/AC3 are already done; what remains is AC4 (verify
   `chartScales.ts` already carries `visualization.ts`'s absorbed coverage --
   the retirement inventory says it does, but T-1015-6 should confirm, not
   assume), AC6 (legacy `localStorage` key migration/cleanup), and
   `activity.ts`/`snapshots.ts`/`snapshotGuard.ts`'s still-pending,
   correctly-untouched contingent retirement.

`ToolSpec.available` also changed from `(ws: WorkspaceState) => boolean` to
`(): boolean` -- every existing implementation across the new surface
already ignored the argument (`() => true`, or a closure over its own
deps), so this needed no changes outside `webmcp/` and `webmcp/screener/`.
