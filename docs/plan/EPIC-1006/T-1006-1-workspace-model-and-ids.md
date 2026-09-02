# T-1006-1: Workspace document model and stable-ID scheme

**Epic**: EPIC-1006 (Workspace, Revisions & the Common Tool Contract)
**Design**: docs/design/workspace-revisions/
**Status**: Open
**Depends on**: —
**Blocks**: T-1006-4, T-1006-5

## Description

The program's design doc requires that every resource be addressed by a
stable ID — never "panel 3", never a bare ticker. This ticket introduces
the ID scheme and the workspace document those IDs live in: panels, layout,
links, active symbol, screener binding and a revision number. Nine sibling
epics build their state on top of this document, so it must be extensible
without being edited.

## User Story

As an epic building a chart, screener or results feature,
I want one workspace document model and one way to mint and validate
resource IDs,
so that my panels and my references to them mean the same thing everyone
else's do, and reordering never changes what an ID points at.

## Acceptance Criteria

1. An ID can be minted for a resource kind and is a single opaque string
   that reads legibly to a human, carrying its kind, an optional
   discriminator and a sequence number.
2. A minted ID can be parsed back into its kind, discriminator and
   sequence; an unrecognized or malformed string parses as invalid rather
   than throwing.
3. A value can be checked for being a valid ID, optionally of a specific
   kind.
4. Sequence numbers never repeat within a kind for the lifetime of a
   sequencer, including after a resource is removed, so a deleted panel's
   ID is never handed to a later panel.
5. A sequencer can be created from a seed so IDs continue from where a
   persisted workspace left off rather than restarting at 1.
6. A workspace document carries an ID, a name, a revision, creation and
   update timestamps, its panels, its layout entries, its panel links, its
   active symbol, its focused panel and its bound screener.
7. Panels carry a stable ID, a kind drawn from the panel kinds the design
   doc names, a title, collapsed and visible flags, an optionally bound
   resource ID, and their own configuration.
8. Layout positions are expressed in logical grid coordinates, not pixels.
9. A panel link records its source panel, its target panel and which
   channel is synchronized.
10. A workspace carries a namespaced extension area in which a sibling
    epic can store its own state without this ticket's files changing.
11. An empty workspace can be constructed for a given ID, name and
    timestamp, at revision 1.
12. Malformed, partial or foreign data passed through normalization
    returns a valid workspace document instead of throwing, matching the
    resilience the existing workspace store already provides.

## Design References

- `docs/reference/tool-spec.md` — "Common contract for every tool" (stable
  IDs); the Workspace rows name the panel kinds and the logical-grid
  layout requirement.
- `docs/design/workspace-revisions/technical.md` — "T-1006-1" section
  gives the exact exported signatures other epics import.
- `src/lib/webmcp/types.ts` — the existing handle-based model this
  replaces in spirit; note its `PanelSummary` for prior art.
- `src/lib/workspace/store.ts` — `normalizeWorkspace`'s
  never-throw-on-corrupt-data pattern to follow.

## Solution Approach

Two pure-domain modules, no I/O. `ids.ts` implements `mintId`/`parseId` over
a fixed `'<kind>_<discriminator?>_<seq>'` string grammar (discriminator
omitted when not given, e.g. `workspace_1` vs `panel_chart_1`); `parseId`
returns `null` (never throws) on anything that doesn't match the grammar or
whose kind isn't in `ResourceKind`. `createIdSequencer(seed?)` holds a
`Record<ResourceKind, number>` counter per kind (keyed further by
discriminator so `panel_chart_*` and `panel_grid_*` don't share a counter),
seeded from a persisted workspace's high-water marks so restarts never
reuse a sequence number — satisfying "never reused after deletion" because
the sequencer only ever increments, regardless of what still exists.

`workspace.ts` defines `WorkspaceDocument`/`PanelRecord`/`LayoutEntry`/
`PanelLink` exactly per `technical.md`, plus `emptyWorkspace` (revision 1,
empty arrays, `extensions: {}`) and `normalizeWorkspace`, which follows
`src/lib/workspace/store.ts`'s `normalizeWorkspace` precedent: defensively
default every array/object field, drop malformed panel/layout/link entries
rather than throwing, and pass `extensions` through untouched (even unknown
keys) so a sibling epic's state round-trips even when this module has no
idea what's in it.

**Contracts introduced:** `ResourceKind`, `ResourceId`, `ParsedId`,
`IdSequencer`, `WorkspaceDocument`, `PanelRecord`, `LayoutEntry`,
`PanelLink` — all in `src/lib/workbench/domain/`, per `technical.md`'s
module layout.

## Technical Considerations

- Modules: `src/lib/workbench/domain/ids.ts` and
  `src/lib/workbench/domain/workspace.ts`. Pure domain — no storage, no
  I/O, no imports from `infra/` or `application/`.
- Exported contract surface other epics depend on: `ResourceKind`,
  `ResourceId`, `ParsedId`, `mintId`, `parseId`, `isResourceId`,
  `IdSequencer`, `createIdSequencer`, `Revision`, `WorkspaceDocument`,
  `PanelRecord`, `LayoutEntry`, `PanelLink`, `emptyWorkspace`,
  `normalizeWorkspace`.
- `ResourceKind` is the single place a sibling epic adds a prefix; keep it
  a union type so an unknown kind is a compile error rather than a silent
  typo.
- `extensions: Record<string, unknown>` is the sibling-epic extension
  point. Normalization must preserve unknown extension keys untouched —
  dropping them would silently destroy another epic's state.
- Tests beside the modules as `*.test.ts` (Vitest), covering round-trip
  mint/parse, non-reuse after deletion, seeded continuation, and
  normalization of corrupt input.

## Out of Scope

Persistence (T-1006-4), revisions changing (T-1006-5), and any panel
behavior — this ticket delivers shapes and ID mechanics only.
