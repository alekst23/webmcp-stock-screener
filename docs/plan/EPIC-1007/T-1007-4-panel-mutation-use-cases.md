# T-1007-4: Panel mutation use cases over the common contract

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Done
**Depends on**: T-1007-1, T-1007-2, T-1007-3
**Blocks**: T-1007-5

## Description

Wave 1 produced three independent pure modules — the panel entity and
kind registry, the grid geometry, and the link graph. This ticket
composes them into the fourteen actual panel operations against a live
workspace, and makes each one a well-behaved citizen of the common
mutation contract EPIC-1006 owns: optimistic concurrency via
`expected_revision`, replay safety via `idempotency_key`, a standard
result envelope, and a registered inverse so the change can be undone.

The operations split into three groups: panel lifecycle and layout
(`create_panel`, `duplicate_panel`, `remove_panel`, `set_panel_layout`,
`apply_layout_template`, `split_panel`, `maximize_panel`) built entirely
from T-1007-1 and T-1007-2; linking and selection (`link_panels`,
`unlink_panels`, `set_panel_selection`) built from T-1007-3; and
source/renderer mutation (`bind_panel_source`, `set_panel_renderer`,
`configure_panel_view`, `configure_chart_grid`), which additionally
depends on T-1007-7's source/renderer contract registry to validate
source-type compatibility and renderer configuration — those four use
cases cannot be finished until T-1007-7 lands, though they can be
scaffolded against its contract in parallel.

Done looks like: fourteen use cases that each take a workspace and a
request and return the standard envelope, unit-tested against a fake
workspace, with no WebMCP or UI involvement.

## User Story

As an agent mutating a workspace,
I want every panel operation to either apply completely or not at all,
tell me exactly what changed, refuse to act on a stale view of the
workspace, and be reversible,
so that I can compose a layout confidently and recover from a mistake in
one call.

## Acceptance Criteria

1. `create_panel` validates the kind against the registry, validates the
   initial source and renderer against T-1007-7's contract registry,
   validates the configuration against that kind and renderer, resolves a
   footprint — the caller's if supplied, an auto-chosen free one
   otherwise — validates the placement, and adds the panel with a newly
   minted stable ID; a failure at any step leaves the workspace untouched.
2. `duplicate_panel` copies an existing panel's kind, configuration,
   source, and renderer to a new panel with a fresh stable ID and an
   auto-chosen footprint, optionally overriding the symbol or source
   supplied in the request; the original panel is untouched.
3. `configure_panel_view` can change a panel's title, visibility,
   collapsed state, and renderer-specific view configuration
   independently and in combination; view configuration is validated
   against the panel's active renderer contract (T-1007-7).
4. `bind_panel_source` changes a panel's source, rejecting a source type
   the panel's kind or active renderer does not accept.
5. `set_panel_renderer` changes a panel's renderer without changing its
   source, preserving configuration fields the new renderer's contract
   still recognizes and clearing the rest with a warning.
6. `configure_chart_grid` sets rows, columns, item count, pagination,
   shared studies, and chart settings for a panel whose renderer is
   `chart_grid`, validated against the chart-renderer contract.
7. `set_panel_layout` applies a batch of footprints all-or-nothing, and
   panels absent from the batch are unmoved. `apply_layout_template`
   applies a named template's footprints to every panel in one
   all-or-nothing batch. `split_panel` divides one panel's footprint into
   two, creating a new panel. `maximize_panel` changes only the rendered
   state, never the stored footprint, and is reversible without consuming
   a revision on the way back.
8. `link_panels` validates each panel's kind against the requested
   channel before any link is created, and supports joining a channel's
   group; `unlink_panels` supports leaving one, affecting only the named
   channel. `set_panel_selection` propagates a selection to every panel
   linked on the `result_selection` channel.
9. `remove_panel` deletes the panel, frees its cells, drops it from every
   channel's group, and dissolves groups left with fewer than two
   members.
10. Every operation returns the common mutation envelope: a change ID,
    the new revision, the affected stable IDs, a human-readable diff
    summary, warnings, and an undo token — except `maximize_panel`,
    which is a rendering-only toggle and does not consume a workspace
    revision (see T-1007-6).
11. `affected_ids` names every panel the change actually touched — the
    subject panel plus, for a removal or an unlink, the panels whose link
    groups changed as a result.
12. An operation whose `expected_revision` does not match the workspace's
    current revision is rejected as a conflict and changes nothing.
13. An operation repeated with an `idempotency_key` already applied
    returns the original envelope and applies no second change.
14. Each revisioned operation registers an inverse such that redeeming
    the returned undo token restores the workspace's panels, footprints,
    sources, renderers, and link groups to their prior state — verified
    for every operation in AC10's set, including that an undone removal
    restores the panel's original ID, configuration, footprint, and link
    memberships.
15. A failed operation never consumes a revision and never emits an undo
    token.

## Design References

- `docs/design/panel-system/spec.md` — every scenario for add, update,
  lay out, link, and remove
- `docs/design/panel-system/technical.md` — "Consumed from EPIC-1006"
  table and the use-case list
- `docs/plan/EPIC-1006/_epic.md` — the workspace/revision model, stable-ID
  minting, mutation envelope, `expected_revision`, `idempotency_key`, and
  undo token contracts this ticket consumes
- `docs/reference/tool-spec.md` — the canonical envelope shape
- `docs/plan/EPIC-1007/T-1007-7-panel-source-renderer-registry.md` — the
  source/renderer contract registry that `bind_panel_source`,
  `set_panel_renderer`, `configure_panel_view`, and `configure_chart_grid`
  validate against

## Technical Considerations

- **This ticket is blocked until EPIC-1006 lands.** Do not re-implement
  revisions, ID minting, the envelope, idempotency storage, or the undo
  store — consume them. If a needed piece of EPIC-1006's surface is
  missing, raise it rather than building a local copy.
- Keep each use case at or under the project's method size limit;
  validation sequences belong in the Wave 1 domain modules, not inlined
  here.
- `diff_summary` is read by a human in the activity log — it should name
  the panel and what changed, not restate the request.
- New files only. Do not modify the existing 11-tool surface,
  `src/lib/workspace/store.ts`, or the current UI.

## Out of Scope

Tool schemas and agent-facing error shaping (T-1007-5), rendering
(T-1007-6), and any panel-kind-specific behavior beyond calling the
kind's own validator.

## Solution Approach

All new files under `src/lib/panels/application/`. Nothing in wave 1 or
EPIC-1006 is modified.

### Persistence (`panelState.ts`)

`doc.extensions['panel_system']` is the source of truth for `panels`,
`links` (a `PanelLinkGraph`) and `selections` (`panelId -> resultIds[]`).
It has to be, not `doc.panels`: EPIC-1006's `PanelKind` union is closed to
the same eight kinds this epic ships, and `normalizeWorkspace` silently
drops any panel record whose kind isn't in that union — a ninth kind a
sibling epic registers later would be destroyed on the next normalize if
it lived in `doc.panels` directly.

`readPanelState(doc)` parses `doc.extensions['panel_system']`
defensively (same resilience contract as `normalizeWorkspace`: malformed
or absent data yields `{ panels: [], links: emptyLinkGraph(), selections:
{} }`, never a throw), dropping individual malformed entries rather than
the whole state.

`writePanelState(doc, state)` stores `state` verbatim under the extension
key, then recomputes `doc.panels` / `doc.layout` / `doc.links` from
scratch (never patched incrementally, never read back as state):
- `doc.panels`: one `PanelRecord` per `Panel` whose `kind` is in
  EPIC-1006's eight-kind set (reproduced as a local constant here, since
  `workbench/domain/workspace.ts` doesn't export its internal set) —
  `visible: !panel.hidden`. A panel outside that set is skipped, not
  corrupted into a bogus record.
- `doc.layout`: one `LayoutEntry` per projected panel, from `panel.rect`.
- `doc.links`: EPIC-1006's model is pairwise
  (`sourcePanelId`/`targetPanelId`), ours is per-channel groups. Each
  group of N panels projects to a consecutive chain of N-1 pairwise
  links (enough to reconstruct the group's connectivity for display,
  without generating the full O(N^2) pairing). `result_selection` is the
  one channel name that differs between the two systems — it maps to
  `'selection'` here, and this is the only place that mapping happens.

### Shared use-case plumbing (`support.ts`)

`PanelUseCaseDeps` (workspaceId, repository, revisions, history, clock,
ids, kinds, sourceRenderer, templates — all injected, never
module-global) plus `commitPanelChange(deps, context, operationKind,
requestInput, build)`, a thin wrapper around EPIC-1006's `recordCommit`
that: loads the doc, calls `readPanelState`, hands `(doc, state)` to
`build`, calls `writePanelState` on the result, and sets `inverse` to a
draft whose `document` is the untouched pre-mutation `doc` — the
"simplest correct inverse" the ticket calls for. Every use case becomes
`build(doc, state) -> { nextState, affectedIds, diffSummary, warnings? }`
plus validation, which is what keeps each use case under the line limit:
all revision/idempotency/history/inverse wiring lives in one place.

Validation helpers (`requirePanelKind`, `requireKnownRenderer`,
`findPanel`, `visibleOccupied`, `throwPlacementViolation`,
`throwLinkFailure`, grid-full) wrap wave-1's typed failures
(`PlacementViolation`, `LinkFailure`, `UnknownPanelKindError`,
`UnknownLayoutTemplateError`) into one consistent `PanelOperationError`
so every panel-specific failure this epic raises has the same wire shape,
per the ticket's `errors.ts` requirement — since T-1007-5 shapes agent
text from the payload, not the message.

### Config validation boundary (an assumption, flagged for T-1007-7)

`create_panel`/`duplicate_panel` validate `config` with
`kindDef.validateConfig` only — the design doc states a kind's
`validateConfig` "delegates to the active renderer's own validateConfig"
for a data-bearing kind, so calling it once is meant to cover both. The
wave-1 placeholder kinds don't yet do that delegation (each validates
only its own `configSchema`), and their schemas are disjoint from their
default renderer's schema (e.g. `chart`'s `{symbol,timeframe,studies}`
vs. `chart_grid`'s `{rows,columns,...}`) — so also calling
`sourceRenderer.validateRendererConfig` at creation time would reject
every kind's own default config. `configure_chart_grid` and
`configure_panel_view` are the ones that actually validate against the
renderer contract (AC3, AC6), which is where the ticket's renderer
validation requirement is exercised for real.

### Use cases (one file each, `build()` under 40 lines)

`createPanel`, `duplicatePanel`, `removePanel`, `setPanelLayout`,
`applyLayoutTemplate`, `splitPanel`, `bindPanelSource`,
`setPanelRenderer`, `configureChartGrid`, `configurePanelView`,
`linkPanels`, `unlinkPanels`, `setPanelSelection` — each
`(deps: PanelUseCaseDeps, request) => MutationEnvelope`, request always
carries `context: MutationContext`. `maximizePanel` is not one of these:
it's `renderedRects(panels, maximizedPanelId)` in `maximize.ts`, a pure
function with no deps, no commit, no revision.

Notable request-shape decisions not settled by the design docs:
- `apply_layout_template` takes an explicit `panelIds` list mapped
  positionally to the template's slots (rather than guessing which
  subset of the workspace's panels to use).
- `split_panel`'s new panel copies the original's kind/source/renderer/
  config (like `duplicate_panel`), placed in the freed half.
- `unlink_panels` takes a `panelIds` batch (plural, matching its name)
  and applies each removal to a local copy of the graph before writing
  anything back, so one unknown membership fails the whole batch.

### Tests

`testSupport.ts` exports `createPanelTestHarness()`: in-memory
repository (`memoryStorage()`), fixed clock, fresh `IdSequencer`, and
freshly-seeded panel-kind / source-renderer / layout-template registries
(via each wave-1 module's `registerDefault*` function) — never the
module-global default registries. Every test builds its own harness.
Colocated `*.test.ts` per use case, covering all 15 ACs; the idempotency-
replay and undo-restores-links tests get mutation-checked per the
ticket's requirement.
