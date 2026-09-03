# T-0020-9: Guard against duplicate /workbench composition on remount

**Epic:** EPIC-0020
**Status:** Done

## Solution Approach

- Added `src/lib/workbench/composition/workbenchCompositionGuard.ts`:
  `createWorkbenchCompositionGuard(compose = registerWorkbenchComposition)`
  returns a `{ ensure() }` object that composes on the first `ensure()` call
  and caches the _promise_ (not just its resolved value, so two concurrent
  callers before the first composition settles still only compose once) —
  every later `ensure()` returns that same cached promise. Kept as a small,
  plain, injectable wrapper (rather than a guard baked into
  `registerWorkbenchComposition()` itself) precisely so
  `registerWorkbenchComposition()` stays ungated: its own test file and
  `workbenchCompositionRoot.e2e.test.ts` call it fresh, repeatedly, each
  expecting a brand-new independent composition — gating it internally would
  have broken both.
- `src/routes/workbench/+page.svelte` now creates one
  `compositionGuard` in a `<script module>` block (Svelte 5's module-scoped
  script, which runs once and is shared across every instance of the
  component created from remounting this same route module) and calls
  `compositionGuard.ensure()` from `onMount` instead of calling
  `registerWorkbenchComposition()` directly. A second mount now reuses the
  first mount's runtime rather than silently building an orphaned second
  composition.
- This repo has no Svelte component-render test harness (no
  `@testing-library/svelte`), so the guard's behavior is unit-tested
  directly and exhaustively in
  `workbenchCompositionGuard.test.ts` (compose-once, cached-promise-under-
  concurrency, and the real-default-argument wiring) rather than via a
  component test.
- The dead `export type { WorkbenchSharedInfra }` re-export from
  `workbenchCompositionRoot.ts` was removed as part of T-0020-6's pass over
  the same file (both tickets touched
  `workbenchCompositionRoot.ts`'s import/export block, so the removal
  landed in that commit rather than a separate one here) — no importer
  anywhere used it; every caller that needs the type imports it directly
  from `registerPanelTools.ts`.

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
