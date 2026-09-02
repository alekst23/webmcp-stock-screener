# T-1007-5: The fourteen panel WebMCP tools

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Open
**Depends on**: T-1007-4, T-1007-7
**Blocks**: T-1007-6

## Description

Expose the panel use cases as the fourteen tools the agent actually
calls: `create_panel`, `duplicate_panel`, `remove_panel`,
`set_panel_layout`, `apply_layout_template`, `split_panel`,
`maximize_panel`, `bind_panel_source`, `set_panel_renderer`,
`configure_chart_grid`, `configure_panel_view`, `link_panels`,
`unlink_panels`, and `set_panel_selection`. The value of this ticket is
almost entirely in the schemas and the error text — an agent that cannot
see which panel kinds exist, which source and renderer types are
compatible, which configuration a renderer takes, or why a placement was
refused will loop instead of self-correcting.

Done looks like: fourteen tool definitions with complete, discoverable
input schemas and self-correcting error results, tested without a
browser.

## User Story

As an AI agent with no view of the page,
I want each panel tool to describe exactly what it accepts and, when it
refuses, to tell me what was wrong and what the valid options were,
so that a mistaken call becomes a one-turn correction rather than a retry
loop.

## Acceptance Criteria

1. Fourteen tools are defined — `create_panel`, `duplicate_panel`,
   `remove_panel`, `set_panel_layout`, `apply_layout_template`,
   `split_panel`, `maximize_panel`, `bind_panel_source`,
   `set_panel_renderer`, `configure_chart_grid`, `configure_panel_view`,
   `link_panels`, `unlink_panels`, `set_panel_selection` — each with a
   description that states what it does and what it returns.
2. Every revisioned tool's input schema accepts `expected_revision` and
   `idempotency_key`, and every successful result carries the full
   mutation envelope; `maximize_panel` is documented as the one exception
   (rendering-only, no revision consumed) per T-1007-4 AC10.
3. `create_panel`'s schema enumerates the registered panel kinds and the
   registered source and renderer types, and its per-kind configuration
   is described from each kind's own declared configuration schema and
   each renderer's own declared configuration schema (T-1007-7) rather
   than being hardcoded — adding a kind, source type, or renderer type to
   either registry changes the schema with no edit to this tool.
4. `set_panel_layout` accepts a batch of panel IDs with grid positions
   and sizes, and its schema contains no pixel, percentage, or viewport
   unit. `apply_layout_template` accepts a template name from the
   registered set. `split_panel` accepts a panel ID and a horizontal or
   vertical direction. `maximize_panel` accepts a panel ID, or no ID to
   clear the maximized state.
5. `link_panels` and `unlink_panels` each accept a channel and the panel
   IDs to join or remove from that channel's group.
6. `configure_panel_view` accepts title, visibility, collapsed state, and
   renderer-specific view configuration, each optional, and applies only
   the fields supplied. `bind_panel_source` accepts a source reference.
   `set_panel_renderer` accepts a renderer name and, optionally,
   renderer-specific configuration. `configure_chart_grid` accepts rows,
   columns, item count, pagination, shared studies, and chart settings.
   `set_panel_selection` accepts one or more result IDs, or an empty set
   to clear the selection.
7. `remove_panel` and `duplicate_panel` each accept a single stable panel
   ID; `duplicate_panel` additionally accepts an optional symbol or
   source override.
8. Every panel is addressed by stable ID; no tool accepts a positional or
   ordinal reference to a panel.
9. A failed call returns an error result — never a success envelope —
   whose text names the cause and, where a closed set exists, lists the
   valid options: registered kinds for an unknown kind, registered source
   or renderer types for an unsupported binding or renderer change, the
   grid bounds or occupying panel for a bad placement, the kind's
   supported channels for an unsupported link, the rejected fields for
   invalid configuration.
10. A revision conflict and a replayed idempotency key are each
    distinguishable by the agent from a validation failure.
11. The fourteen tools are exposed through a factory that can be built
    and invoked in a unit test with no browser and no
    `document.modelContext`.

## Design References

- `docs/reference/tool-spec.md` — the fourteen tools' purposes, the
  "Panels: source and renderer are separate" section, and the common
  contract every tool returns
- `docs/design/panel-system/spec.md` — the failure scenarios each error
  message must serve
- `docs/design/panel-system/technical.md` — the tool surface's location
  and its relationship to the existing surface
- `src/lib/webmcp/tools.ts` — the existing `buildTools(engine)` factory,
  `ok`/`fail` result shaping, and the `ExpressionError` precedent for
  returning a valid-options catalog on failure so the agent can
  self-correct
- `src/lib/webmcp/types.ts` — the `ToolSpec` and `ToolResult` shapes to
  mirror

## Technical Considerations

- Follow the existing surface's conventions but do not import from or
  modify it; the new surface is a parallel implementation that EPIC-1015
  will leave standing when the old one is retired.
- The self-correcting-error pattern already exists in this codebase —
  `ExpressionError` returns the function catalog alongside the failure.
  Reuse the idea, not the class.
- `create_panel`'s schema must be generated from the panel-kind and
  source/renderer registries at build time, not written out by hand, or
  AC3 fails the moment a sibling epic registers its kind, source type, or
  renderer type.

## Out of Scope

Registering the tools against `document.modelContext` and rendering
(T-1007-6), and the use-case logic itself (T-1007-4).

## Solution Approach

**Location.** `docs/design/panel-system/technical.md`'s "Tool surface"
section names `src/lib/webmcp/v2/panelTools.ts`, but the working
instructions for this ticket are explicit and repeated: new files only
under `src/lib/panels/tools/`, nothing under `src/lib/webmcp/`. Building
there — a design-doc/instruction conflict the technical.md text did not
anticipate (it predates the `panels/` package layout actually landing).
Noted for T-1007-6/EPIC-1015 wiring, not resolved here.

**Files** (all new, under `src/lib/panels/tools/`):

- `wire.ts` — snake_case ⇄ camelCase plumbing shared by every tool:
  `parseContext` (`expected_revision`/`idempotency_key` → `MutationContext`),
  `fromWireRect`/`toWireRect` (`col_span`/`row_span` ⇄ `colSpan`/`rowSpan`),
  `toWireOccupiedRect`.
- `results.ts` — local `ok`/`fail` (not imported from
  `src/lib/webmcp/tools.ts`, per the ticket's explicit instruction) plus
  `toErrorResult`, which maps `PanelOperationError`, `RevisionConflictError`,
  `IdempotencyConflictError`, and `StorageWriteError` through their shared
  `toWireError()` — mirroring, not importing,
  `src/lib/workbench/tools/index.ts`'s `toErrorResult`.
- `schemas.ts` — every JSON-Schema fragment built from the registries at
  call time: kind/source-type/renderer-type/template-name enums, the grid
  rect fragment (integers only, described bounds, no unit), and
  `x-kind-config-schemas`/`x-renderer-config-schemas`/`x-source-ref-schemas`
  side-channel properties on `create_panel` (and `x-source-ref-schemas` on
  `bind_panel_source`, `x-renderer-config-schemas` on `set_panel_renderer`/
  `configure_panel_view`) carrying each registered definition's own
  `configSchema`/`refSchema` verbatim — this is what makes AC3 hold without
  hand-written per-kind branches. `configure_chart_grid`'s field schema is
  generated too: it reads the `chart_grid` `RendererTypeDefinition`'s own
  `configSchema.properties` from the registry and snake_cases each key,
  rather than listing `rows`/`columns`/... by hand.
- `lifecycleTools.ts` — `create_panel`, `duplicate_panel`, `remove_panel`.
- `layoutTools.ts` — `set_panel_layout`, `apply_layout_template`,
  `split_panel`, `maximize_panel`. `maximize_panel` reads the current
  document straight off `deps.repository` (no `commitPanelChange`, no
  `MutationContext` in its schema) and drives the injected
  `deps.maximized` handle.
- `sourceRendererTools.ts` — `bind_panel_source`, `set_panel_renderer`,
  `configure_chart_grid`, `configure_panel_view`.
- `linkTools.ts` — `link_panels`, `unlink_panels`, `set_panel_selection`.
- `maximizedState.ts` — `createMaximizedPanelState()`, a trivial in-memory
  implementation of the `MaximizedPanelHandle` shape, for T-1007-6 and
  tests to use so no module-global survives.
- `panelTools.ts` — `PanelToolDeps` (`PanelUseCaseDeps & { maximized:
  MaximizedPanelHandle }`) and `buildPanelTools(deps): ToolSpec[]`,
  assembling the five tool-group builders. `available: () => true` for
  all fourteen, per instruction.

**Error mapping (AC9/AC10).** Every revisioned tool's `execute` wraps its
use-case call in `try { ... } catch (err) { return toErrorResult(err); }`.
`toErrorResult` never rebuilds a payload — every closed-set catalog
(registered kinds, source/renderer types, template names, supported
channels, grid bounds/occupant, rejected field paths) already lives on
`PanelOperationError.details` via `toWireError()`, and `RevisionConflictError`/
`IdempotencyConflictError` carry `error: 'revision_conflict'` /
`'idempotency_conflict'` themselves — surfaced, not reproduced.

**Testing.** Colocated `*.test.ts` per source file, using
`createPanelTestHarness()`. `panelTools.test.ts` covers the cross-cutting
ACs (1, 2, 8, 9 generic shape, 10, 11) and AC3's extensibility test: build
an isolated `PanelRegistry`/`SourceRendererRegistry`/`LayoutTemplateRegistry`,
register one fictional kind/source type/renderer type/template, rebuild
`buildPanelTools`, and assert the new names surface in `create_panel`'s
enums and `x-*-schemas`, with no edit to any file in `tools/`.
