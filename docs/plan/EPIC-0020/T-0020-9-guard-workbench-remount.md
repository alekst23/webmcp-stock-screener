# T-0020-9: Guard against duplicate /workbench composition on remount

**Epic:** EPIC-0020
**Status:** Open

## Goal

`+page.svelte`'s `onMount` calls `registerWorkbenchComposition()` with no
`onDestroy`/unregister and no guard against a second invocation. If
`/workbench` is ever mounted twice (SPA back/forward navigation without a
full reload, a future in-app link into the route, an HMR-adjacent
remount), a second independent `WorkspaceRepository`/`PinnedRunStore`/etc
is built and all tool names silently rebind to it — any in-flight tool
call from the first mount's infra lands in a repository no rendered
`PanelContainer` will read again. No route currently links into
`/workbench`, so this is latent, not active, today. Found by EPIC-0020's
epic review (2026-09-02).

Also bundle in a trivial, unrelated cleanup while touching this area: the
exported `type WorkbenchSharedInfra` re-export from
`workbenchCompositionRoot.ts` has zero importers anywhere in the codebase
(only the value `createWorkbenchSharedInfra` is ever imported) — remove
the dead type re-export, or confirm a real future need and keep it with a
comment saying why.

## Acceptance criteria

- A second call to `registerWorkbenchComposition()` on an already-composed
  page either reuses the existing shared infra or is explicitly guarded
  against (e.g. a module-level flag, or unregistering the prior mount's
  tools first) — no silent orphaned second instance.
- `WorkbenchSharedInfra`'s dead type re-export is removed or justified.
