# T-0027-1: Read-only screener widget body

**Epic**: EPIC-0027 (Screener Widget and Drag-to-Chart)
**Design**: docs/design/screener-core/
**Status**: Done
**Depends on**: —
**Blocks**: —

## Description

`filter_builder` is a registered panel kind with no body — a placeholder.
This ticket gives it a real, read-only view of the workspace's current
screener (the one `WorkspaceDocument.screenerId` points at): universe,
conditions, ranking, and limit. It renders from the same document read
every other panel body already uses (`repository.get` + the existing
observer notify) — no new tool, no new read path.

## User Story

As a human watching the agent build a screener,
I want to see its current settings on the canvas as it's built,
so that I can verify what the agent did before it runs, without asking.

## Acceptance Criteria

1. With no current screener on the workspace, the panel shows an
   explicit empty state ("no screener yet" or equivalent) — never blank,
   never an error.
2. Once a screener exists, the panel renders its universe, filter tree
   summary, ranking, and limit.
3. When the agent redefines the screener (`define_screener`), the panel's
   content updates on the next observer notify — no manual refresh, no
   stale content.
4. The panel exposes no controls that mutate the screener — it is a
   mirror of agent-driven state, not an editor, for this ticket.

## Out of Scope

- Any input control that lets a human edit the screener definition
  directly through this view — explicitly deferred; redefinition stays
  agent-driven only for MVP.

## Solution Approach

Real `filter_builder` `PanelKindDefinition`, replacing
`defaultPanelKinds.ts`'s placeholder, following the exact
`resultsTablePanelKind.ts` / `watchlistPanelKind.ts` precedent (real
registration before the placeholder defaults, registration-time runtime-deps
singleton for the lazily-loaded body, `defaultSize`/`minSize`/`linkChannels`
reused verbatim from the placeholder's own KindSpec so the seeded layout
never changes):

- `src/lib/screener/panel/filterBuilderPanelContext.ts` — registration-time
  singleton (`useCaseDeps`), mirrors `watchlistPanelContext.ts`.
- `src/lib/screener/panel/filterTreeSummary.ts` — pure, unit-tested text
  summarization of `UniverseSpec`, `FilterNode` (flattened depth-first
  outline), and `RankingSpec | null`. No Svelte, no I/O.
- `src/lib/screener/panel/FilterBuilderPanel.svelte` — the body. Reads
  `deps.useCaseDeps.repository.get(workspaceId)` once per mount (not
  reactively) and `readScreener(doc, doc.screenerId)`; renders the
  `filterTreeSummary.ts` output. `screenerId === null` or `readScreener`
  returning `null` both render the AC1 empty state ("No screener yet.").
  Live update (AC3) relies on `PanelContainer.svelte`'s existing
  remount-on-observer-notify cycle — the same mechanism every other panel
  body already uses — not a bespoke subscription in this component.
- `src/lib/screener/registry/filterBuilderPanelKind.ts` —
  `createFilterBuilderPanelKindDefinition` / `registerFilterBuilderPanelKind`.
  `validateConfig` stays permissive (this body never writes through
  `panel.config`), matching the placeholder's own leniency.
- Wired into the composition root
  (`src/lib/panels/shell/registerPanelTools.ts`), before
  `registerDefaultPanelKinds`/`seedDefaultWorkspace`, so a brand-new
  workspace's seeded `filter_builder` panel (`DEFAULT_SEED_PANELS`'s sole
  entry) renders the real body immediately.

**Fixture/assumption (no EPIC-0026 landing yet):** `WorkspaceDocument`'s
`screenerId` field and `screener/state.ts`'s `readScreener`/`writeScreener`
already exist on `main` (EPIC-1009), independent of EPIC-0026's
`define_screener` tool. Tests seed a current screener directly —
`writeScreener(doc, screener)` then `repository.put({ ...doc, screenerId:
screener.screenerId })` — exactly the shape `define_screener` will produce
once EPIC-0026 lands, so no behavior here depends on that epic landing
first, per the epic doc's own note.

Tests: `filterTreeSummary.test.ts` (pure), `filterBuilderPanelKind.test.ts`
(registration), `FilterBuilderPanel.test.ts` (component, one test per AC).
