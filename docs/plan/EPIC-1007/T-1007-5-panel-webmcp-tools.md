# T-1007-5: The five panel WebMCP tools

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Open
**Depends on**: T-1007-4
**Blocks**: T-1007-6

## Description

Expose the panel use cases as the five tools the agent actually calls:
`add_panel`, `update_panel`, `set_panel_layout`, `link_panels`, and
`remove_panel`. The value of this ticket is almost entirely in the
schemas and the error text — an agent that cannot see which panel kinds
exist, which configuration a kind takes, or why a placement was refused
will loop instead of self-correcting.

Done looks like: five tool definitions with complete, discoverable input
schemas and self-correcting error results, tested without a browser.

## User Story

As an AI agent with no view of the page,
I want each panel tool to describe exactly what it accepts and, when it
refuses, to tell me what was wrong and what the valid options were,
so that a mistaken call becomes a one-turn correction rather than a retry
loop.

## Acceptance Criteria

1. Five tools are defined — `add_panel`, `update_panel`,
   `set_panel_layout`, `link_panels`, `remove_panel` — each with a
   description that states what it does and what it returns.
2. Every tool's input schema accepts `expected_revision` and
   `idempotency_key`, and every successful result carries the full
   mutation envelope.
3. `add_panel`'s schema enumerates the registered panel kinds, and its
   per-kind configuration is described from each kind's own declared
   configuration schema rather than being hardcoded — adding a kind to
   the registry changes the schema with no edit to this tool.
4. `set_panel_layout` accepts a batch of panel IDs with grid positions
   and sizes, and its schema contains no pixel, percentage, or viewport
   unit.
5. `link_panels` accepts a channel, the panel IDs to link, and whether to
   join or leave that channel's group.
6. `update_panel` accepts title, configuration, visibility, collapsed
   state, and bound resource, each optional, and applies only the fields
   supplied.
7. `remove_panel` accepts a single stable panel ID.
8. Every panel is addressed by stable ID; no tool accepts a positional or
   ordinal reference to a panel.
9. A failed call returns an error result — never a success envelope —
   whose text names the cause and, where a closed set exists, lists the
   valid options: registered kinds for an unknown kind, the grid bounds
   or occupying panel for a bad placement, the kind's supported channels
   for an unsupported link, the rejected fields for invalid
   configuration.
10. A revision conflict and a replayed idempotency key are each
    distinguishable by the agent from a validation failure.
11. The five tools are exposed through a factory that can be built and
    invoked in a unit test with no browser and no `document.modelContext`.

## Design References

- `docs/reference/tool-spec.md` — the five tools' purposes and the common
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
- `add_panel`'s schema must be generated from the registry at build time,
  not written out by hand, or AC3 fails the moment a sibling epic
  registers its kind.

## Out of Scope

Registering the tools against `document.modelContext` and rendering
(T-1007-6), and the use-case logic itself (T-1007-4).
