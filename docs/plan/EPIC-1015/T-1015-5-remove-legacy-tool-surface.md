# T-1015-5: Remove the legacy tool surface

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Status**: Open
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

## Out of Scope

The legacy workspace store, engine client, and Svelte components
(T-1015-6). Backend changes (T-1015-4). Doc updates (T-1015-7).
