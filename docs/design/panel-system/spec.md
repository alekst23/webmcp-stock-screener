# Panel System — Product Spec

## Intent

The research workbench is a workspace of panels: a filter builder, a
chart, a results table, a similarity view, a watchlist. Today the app has
a fixed, agent-unaddressable panel arrangement — an agent can create a
grid or a chart panel, but it cannot name a panel kind, place it, resize
it, hide it, retitle it, wire two panels together, or take one away.

This feature makes the panel container itself a first-class, agent-driven
surface: the agent can add any supported panel kind, change what a panel
shows, arrange panels on a logical grid, synchronize state between them,
and remove them — with every change visible to the human, reversible, and
expressed against stable panel IDs rather than positional references.

A panel's **source** — what data it shows (a screener run, a watchlist, a
symbol list, or another panel) — and its **renderer** — how that data is
shown (a table, a chart grid, a heatmap, a scatter plot) — are independent.
Rebinding a panel's source does not change how it is rendered; changing
its renderer does not change what data it is showing. This split is what
lets the same screener run become a table, then a wall of small charts,
without re-running anything.

Panel _contents_ are not this feature's concern. What lives inside a
chart, a screener, a results table, or a similarity panel is owned by
separate features; this feature owns the container, the layout, the
links, and the typed registries those features plug a panel kind, a
source type, or a renderer type into.

## Preconditions

- A workspace exists, with a current revision, stable-ID scheme, mutation
  envelope, and undo support (the common workspace contract — EPIC-1006).
- Every mutation here accepts `expected_revision` and `idempotency_key`
  and returns the standard mutation envelope.

## Features

1. **Add a panel** of a supported kind, with an initial source and
   renderer, to the workspace. **Duplicate** or **remove** one by its
   stable ID.
2. **Configure a panel's** title, view configuration (columns, studies,
   axes, sorting, grouping, formatting), visibility, or collapsed state.
3. **Bind or rebind a panel's source** — the screener run, watchlist,
   symbol list, or panel it shows — independent of how it is rendered.
4. **Change a panel's renderer** — table, chart grid, heatmap, scatter
   plot — independent of its source.
5. **Lay out panels** on a fixed, non-scrolling 6-column by 4-row logical
   grid — position and size in grid cells, never pixels; apply a named
   layout template; split a panel's region; temporarily maximize one
   without changing the saved layout.
6. **Link and unlink panels** so that a change in one propagates to the
   others on a named channel, including a selected result.
7. **Register a panel kind, source type, or renderer type** so a new
   kind of panel, a new place data can come from, or a new way to show
   it becomes addable without changing the panel container itself.
8. **Seed a new workspace with the default layout** — just a filter-builder
   panel, full-height on the left column — so a researcher opening a
   fresh workspace starts from a minimal canvas and adds what they need,
   rather than being handed a pre-populated research layout.
9. **Illustrate the empty grid** — every unoccupied cell on the 6x4 grid
   shows a faint outline of its own boundaries, so the grid the agent (or
   the human) can place panels onto is always visible, not just implied
   by where existing panels happen to sit.
10. **Reset the workspace layout to the default seed** — a human, from a
    control in the shared header, or an agent, discard whatever panel
    arrangement is currently in place and restore the workspace to the
    same default seeded arrangement (item 8's single-panel seed) a
    brand-new workspace gets — as a single reversible change.
11. **Drag a result onto the canvas** *(EPIC-0027)* — a human drags a row
    from a results panel onto an empty grid cell to create a chart panel
    there, or onto an existing chart panel to rebind its source — without
    going through the agent. The drop composes the same "add a panel"
    and "bind or rebind a panel's source" behaviors items 1 and 3 already
    define; it is a second entry point into them, not new mutation
    semantics.

## Supported panel kinds

`filter_builder`, `chart`, `study_library`, `results_table`,
`similar_opportunities`, `watchlist`, `alerts`, `symbol_details`.

## Source types

`screener_results`, `watchlist`, `symbol_list`, `panel_reference`.

## Renderer types

`table`, `chart_grid`, `heatmap`, `scatter_plot`.

## Link channels

`symbol`, `timeframe`, `result_selection`, `crosshair`, `filters`.

## Behavioral Specifications

### Add a panel

| Scenario                      | Given                                                              | When                                                                           | Then                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path                    | a workspace                                                        | the agent adds a panel of a supported kind with an initial source and renderer | a panel of that kind exists with a new stable ID, its kind's default title, default configuration, and a non-overlapping default position and size on the grid; the mutation envelope names the new panel |
| Explicit placement            | a workspace                                                        | the agent adds a panel and supplies a grid position and size                   | the panel is created at exactly that position and size, if it is valid and unoccupied                                                                                                                     |
| Unknown kind                  | a workspace                                                        | the agent adds a panel of a kind that is not registered                        | the call fails, changes nothing, and the error lists every kind that _is_ registered                                                                                                                      |
| Invalid configuration         | a workspace                                                        | the agent adds a panel with configuration its kind rejects                     | the call fails, changes nothing, and the error says which configuration values were rejected and why                                                                                                      |
| No room at the requested spot | a panel already occupies the requested cells                       | the agent adds a panel there                                                   | the call fails with an overlap error naming the occupying panel, and nothing is created                                                                                                                   |
| Grid is full                  | the fixed 6x4 grid has no free rect of the requested size anywhere | the agent adds a panel without an explicit position                            | the call fails, changes nothing, and the error says the grid is full — nothing overflows past row 4 and no existing panel is displaced                                                                    |
| Replay                        | a mutation was already applied under an idempotency key            | the same call is repeated with that key                                        | the original result is returned and no second panel is created                                                                                                                                            |

### Duplicate a panel

| Scenario              | Given                      | When                                                              | Then                                                                                                                                    |
| --------------------- | -------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path            | an existing panel          | the agent duplicates it                                           | a new panel exists with a fresh stable ID, copying the original's kind, configuration, source, and renderer; the original is unaffected |
| Override on duplicate | an existing panel          | the agent duplicates it and supplies a different symbol or source | the new panel is created with the overridden symbol or source instead of the original's; the original is unaffected                     |
| Unknown panel         | no panel with the given ID | the agent duplicates it                                           | the call fails, changes nothing, and says the ID is unknown                                                                             |

### Configure a panel

| Scenario             | Given                                                            | When                                                                                                                              | Then                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Retitle              | an existing panel                                                | the agent sets a new title                                                                                                        | only the title changes; the panel keeps its ID, kind, configuration, source, renderer, and position                                       |
| Reconfigure the view | an existing panel                                                | the agent supplies new view configuration (columns, studies, axes, sorting, grouping, formatting) for the panel's active renderer | the configuration is validated against that renderer's contract and, if valid, replaces or merges into the panel's configuration          |
| Hide and show        | a visible panel                                                  | the agent hides it                                                                                                                | the panel remains in the workspace with its position and configuration intact, but is not rendered; showing it again restores it in place |
| Collapse             | an expanded panel                                                | the agent collapses it                                                                                                            | the panel renders as a header only, retains its stored size, and expanding restores that size                                             |
| Unknown panel        | no panel with the given ID                                       | the agent configures it                                                                                                           | the call fails, changes nothing, and says the ID is unknown                                                                               |
| Stale revision       | the workspace has advanced past the caller's `expected_revision` | the agent configures a panel                                                                                                      | the call is rejected as a conflict and nothing changes                                                                                    |

### Bind a panel's source

| Scenario      | Given                      | When                                                          | Then                                                                                                                                                                          |
| ------------- | -------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rebind        | a panel bound to a source  | the agent binds it to a different source of a compatible type | the panel shows the newly bound source, unchanged renderer; an incompatible source type is rejected without changing the panel, and the error lists the accepted source types |
| Initial bind  | a panel with no source     | the agent binds it to a source its kind and renderer accept   | the panel adopts that source and begins showing its data                                                                                                                      |
| Unknown panel | no panel with the given ID | the agent binds a source to it                                | the call fails, changes nothing, and says the ID is unknown                                                                                                                   |

### Change a panel's renderer

| Scenario                   | Given                                                 | When                                                                                            | Then                                                                                                                                        |
| -------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path                 | a panel with a bound source                           | the agent changes its renderer to a compatible one                                              | the same source is now shown by the new renderer; the source itself is unchanged                                                            |
| Configuration carries over | a panel with renderer-specific configuration          | the agent changes to a renderer whose contract recognizes some of the same configuration fields | the recognized fields carry over; fields the new renderer's contract does not recognize are dropped and reported as a warning, not an error |
| Incompatible renderer      | a panel's source does not accept a requested renderer | the agent requests that renderer                                                                | the call fails, changes nothing, and the error lists the renderers the current source accepts                                               |
| Unknown panel              | no panel with the given ID                            | the agent changes its renderer                                                                  | the call fails, changes nothing, and says the ID is unknown                                                                                 |

### Lay out panels

| Scenario                    | Given                                      | When                                                                                                        | Then                                                                                                                                            |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Move and resize             | one or more existing panels                | the agent sets grid positions and sizes for them                                                            | all of them move/resize together as one change, or none of them do                                                                              |
| Below minimum size          | a panel kind that declares a minimum size  | the agent sets a smaller size                                                                               | the call fails naming the minimum, and no panel moves                                                                                           |
| Out of bounds               | the grid's fixed 6x4 bounds                | the agent places a panel past the last column or row                                                        | the call fails naming the grid bounds, and no panel moves                                                                                       |
| Overlap within one call     | a batch of placements                      | two of them would occupy the same cell                                                                      | the whole call fails identifying the conflicting pair, and no panel moves                                                                       |
| Partial ID set              | a workspace with several panels            | the agent lays out only some of them                                                                        | the named panels move; the unnamed panels stay exactly where they are                                                                           |
| Unaffected by hidden panels | a hidden panel occupying cells             | the agent places a visible panel over those cells                                                           | the placement is accepted — hidden panels reserve their stored position but do not block placement                                              |
| Apply a named template      | a workspace with several panels            | the agent applies a named layout template (`three_columns`, `quad`, `chart_wall_3x3`, `focus_with_sidebar`) | every named panel's footprint is replaced according to the template, atomically                                                                 |
| Unknown template            | a workspace                                | the agent applies a template name that is not registered                                                    | the call fails, changes nothing, and the error lists every registered template                                                                  |
| Split a panel               | an existing panel                          | the agent splits its region horizontally or vertically                                                      | a new panel is created in the freed cells and the original's footprint shrinks to make room; both keep their own ID, kind, source, and renderer |
| Split below minimum         | a panel whose kind declares a minimum size | a split would leave either resulting footprint below that minimum                                           | the call fails naming the minimum, and no panel is split or resized                                                                             |
| Maximize                    | a panel among several                      | the agent maximizes it                                                                                      | that panel temporarily occupies the full grid; every other panel's saved position and size is unchanged                                         |
| Restore from maximize       | a maximized panel                          | the agent clears the maximized state                                                                        | the workspace renders exactly the layout it had before maximizing; the saved layout was never mutated by maximizing                             |

### Link and unlink panels

| Scenario             | Given                                                | When                                                 | Then                                                                                                             |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Happy path           | two panels that both support a channel               | the agent links them on that channel                 | changing the linked value in either panel propagates to the other                                                |
| Multi-panel group    | a link group on a channel                            | the agent links a third panel into it                | all three share the channel's value, and the value in force is the group's current one                           |
| Unsupported channel  | a panel whose kind does not participate in a channel | the agent links it on that channel                   | the call fails naming the channel and the kind, and no link is created                                           |
| Unlink               | linked panels                                        | the agent unlinks one of them from a channel         | that panel stops receiving and emitting on that channel; the remaining panels stay linked to each other          |
| Independent channels | panels linked on one channel                         | the agent links a different pair on another channel  | the two channels' groups are independent; a change on one does not propagate through the other                   |
| Self-link            | one panel                                            | the agent links a panel to itself                    | the call fails and nothing changes                                                                               |
| Duplicate link       | panels already linked on a channel                   | the agent links them again on that channel           | the call succeeds without creating a duplicate, and the envelope reports no effective change                     |
| Select and propagate | panels linked on the `result_selection` channel      | the agent selects one or more results in one of them | the selection propagates to every other panel in that channel's group, and to no panel outside it                |
| Clear selection      | a panel with a selection                             | the agent selects an empty set                       | the panel's selection is cleared, and the clear propagates to its `result_selection` group like any other change |

### Remove a panel

| Scenario      | Given                              | When                                                      | Then                                                                                                                                      |
| ------------- | ---------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path    | an existing panel                  | the agent removes it by ID                                | the panel is gone from the workspace, its grid cells are freed, and the envelope names it as affected                                     |
| Link cleanup  | a panel in one or more link groups | the agent removes it                                      | it is dropped from every link group; a group left with fewer than two panels is dissolved, and the remaining panels are named as affected |
| Unknown panel | no panel with the given ID         | the agent removes it                                      | the call fails, changes nothing, and says the ID is unknown                                                                               |
| Undo          | a removed panel                    | the agent undoes the removal with the returned undo token | the panel returns with its ID, kind, title, configuration, source, renderer, position, size, and link memberships as they were            |

### Register a panel kind

| Scenario       | Given                                  | When                                                                                                                                                                                                     | Then                                                                                                                   |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Happy path     | a feature that owns a panel kind       | it registers that kind with a title, default and minimum size, default configuration, a configuration validator, the link channels it participates in, the source types it accepts, and a body to render | panels of that kind can be added, configured, laid out, linked, and rendered without any change to the panel container |
| Discovery      | a set of registered kinds              | the agent asks what kinds are available                                                                                                                                                                  | every registered kind is listed with the configuration it accepts and the link channels it supports                    |
| Duplicate kind | a kind already registered under a name | the same name is registered again                                                                                                                                                                        | the conflict is reported rather than silently overwriting the first registration                                       |

### Register a source or renderer type

| Scenario       | Given                                                                                       | When                                                                                                                                                                                             | Then                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Happy path     | a feature that owns a renderer (a table, a chart) or contributes a way to source panel data | it registers a source type (name, reference shape, the kind/renderer pairs it is compatible with) or a renderer type (name, configuration schema and validator, defaults, accepted source types) | panels can be bound to that source or switched to that renderer without any change to the panel container |
| Discovery      | a set of registered source and renderer types                                               | the agent asks what is available                                                                                                                                                                 | every registered source and renderer type is listed with its schema and compatibility rules               |
| Duplicate type | a source or renderer type already registered under a name                                   | the same name is registered again                                                                                                                                                                | the conflict is reported rather than silently overwriting the first registration                          |

### Seed a new workspace with the default layout

_Amended by hotfix/empty-grid-canvas — supersedes the three-panel seed below
(and the six-panel "full target composition" it was later expanded to under
T-1015-12). The default layout is now deliberately minimal: the researcher
sees one working control (the filter builder) and an obviously-empty grid
inviting them to add panels, rather than a pre-populated research layout.
This also reverses the more-populated-default-layout intent stated in
docs/design/legacy-surface-cutover/spec.md's route migration feature — that
intent is superseded by this change._

| Scenario                            | Given                                                                   | When                                   | Then                                                                                                                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Happy path                          | a newly created, otherwise-empty workspace                              | the workspace finishes creating        | it already contains one panel — `filter_builder`, full-height on the left column (col 0, rowSpan 4) — with no additional agent or user action required; the remaining 20 cells are empty                                                               |
| Unbound source                      | the seeded panel has nothing to show yet                                | the workspace is opened                | the seeded panel renders its kind's normal empty/not-yet-bound state (e.g. "no filters yet") rather than an error; binding a source to it behaves exactly as it would for a panel added by `create_panel`                                              |
| Not a template a caller can request | the default layout                                                      | an agent calls `apply_layout_template` | it is not registered under any template name — it is create-time-only behavior, not a template the agent can re-apply later; an agent that wants this arrangement again after rearranging the workspace lays it out explicitly or via a named template |
| Restored/duplicated workspace       | a workspace loaded from an existing revision, or a duplicated workspace | it is opened                           | the default layout is never applied — seeding happens only once, at creation of a genuinely new, empty workspace                                                                                                                                       |

### Illustrate the empty grid

| Scenario        | Given                                        | When                          | Then                                                                                                                  |
| --------------- | -------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Happy path      | a workspace with some cells unoccupied       | the workspace is rendered     | every unoccupied cell shows a faint outline of its own grid boundaries, distinct from an occupied cell's panel chrome |
| Fully occupied  | every cell on the 6x4 grid is occupied       | the workspace is rendered     | no empty-cell outlines are shown                                                                                      |
| Fully empty     | no panels exist yet                          | the workspace is rendered     | all 24 cells show the empty-cell outline                                                                              |
| Non-interactive | an empty cell's outline                      | the human clicks or hovers it | nothing happens — the outline never intercepts pointer events or blocks interaction with panels above or beside it    |
| Updates live    | a panel is added, removed, resized, or moved | the workspace re-renders      | the set of outlined empty cells updates to match the new occupancy, with no stale outlines left behind                |

### Reset the workspace layout to the default seed

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path, human | a workspace with panels moved, resized, added, or removed from the original seed | a human clicks the header's reset control and confirms | the workspace's panels are replaced with the same default seeded arrangement described in "Seed a new workspace with the default layout," as one revisioned change; the mutation envelope names every panel affected |
| Happy path, agent | a workspace in any arrangement | an agent invokes the reset action | the same replacement happens as the human path, with the same mutation envelope, no confirmation step required |
| Declined confirmation | a human clicks the header's reset control | the human does not confirm | nothing in the workspace changes |
| Undo | a workspace just reset to the default seed | the human or agent undoes the reset with the returned undo token | the workspace's panels return to exactly the arrangement they had immediately before the reset |
| Already at default | a workspace whose panels already match the default seeded arrangement | the reset action is invoked | the call still succeeds and reports no effective change, rather than failing |

### Drag a result onto the canvas *(EPIC-0027)*

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path, empty cell | a results row and an empty grid cell | the human drags the row onto that cell | a chart panel is created at that exact cell, bound to the row's instrument — the same outcome `create_panel` would produce, at the position dropped rather than auto-placed |
| Happy path, existing chart | a results row and an existing chart panel, empty or already bound to a different instrument | the human drags the row onto it | the panel's source is rebound to the dropped instrument; no new panel is created — `bind_panel_source`'s existing bind-or-rebind semantics, unchanged |
| Incompatible target | a results row and a panel/renderer whose accepted source types do not include an instrument | the human drags the row onto it | the drop is rejected (shown as a not-allowed target) and nothing changes — the same source-type validation `bind_panel_source` already enforces |
| Grid full | a results row and a grid with no empty cell | the human attempts to drop it as a new panel | the drop is rejected with the same "grid is full" case already defined for agent-driven `create_panel` |

## Non-Goals

- The contents of any panel — the filter builder's tree, the similarity
  search — owned by separate features.
- The renderer-specific catalogs and validation contracts a source or
  renderer type registers (available result columns, available
  studies/indicators, their defaults and formatting rules) — owned by the
  feature that registers the type; this feature builds the registry
  mechanism, not the contracts.
- The shared workspace/revision model, stable-ID scheme, mutation
  envelope, `expected_revision`, `idempotency_key`, and undo tokens —
  owned by EPIC-1006 and consumed here.
- Pixel-level layout, drag-to-resize gestures, and responsive breakpoint
  behavior beyond mapping the logical grid onto the viewport.
- Saving/restoring named workspace revisions.
- Retiring the existing 11-tool pattern-research surface — the panel
  system is built alongside it in new files.
- Dragging multiple selected rows at once *(EPIC-0027)* — "make charts
  from the top 5" stays a text/agent path; drag is a single-row gesture.

## Open Questions

_Resolved 2026-09-02 — Grid dimensions: the page is a fixed, non-scrolling
6-column by 4-row grid (24 cells total) that always exactly fills the
viewport — a panel spanning N rows occupies N/4 of the page's height, M
columns occupies M/6 of its width. Replaces the earlier "12-column,
unbounded-row" assumption; see the "Lay out panels" behavioral
specifications for the resulting "grid is full" rejection case, new now
that the grid has a hard capacity._

1. **Link directionality.** The tool spec does not say whether a link is
   directed (source → target) or symmetric.
   _Assumption:_ symmetric per channel — `link_panels` maintains
   undirected link _groups_, one per channel, since "synchronize" reads
   as mutual.
2. **Bound resource types.** "Bound resource" is not enumerated.
   _Assumption:_ an opaque typed reference (`{ type, id }`) to a stable
   ID owned by another feature — screener, run, instrument, watchlist,
   captured setup — validated by the panel kind, not by the container.
3. **Overlap policy.** The spec does not state whether panels may
   overlap.
   _Assumption:_ they may not; overlapping placements are rejected rather
   than auto-reflowed, so the agent gets a clear error instead of a
   surprising rearrangement.
4. **Hidden vs. removed.** The spec lists visibility as a
   `configure_panel_view` field, implying hiding is not removal.
   _Assumption:_ a hidden panel keeps its ID, configuration, links, and
   stored position, and does not reserve grid space against new
   placements.
5. **The "collection" kind.** `docs/reference/tool-spec.md`'s `create_panel`
   example uses `"kind": "collection"`, which does not match any of the
   eight registered kinds above (a `collection` reads as many items
   sharing one `chart_grid`/heatmap renderer — e.g. the top nine matches
   from a screener run, each as its own small chart).
   _Assumption:_ no new kind is added — an existing kind (`chart`) is
   reused with its renderer set to `chart_grid`, and the source/renderer
   contract, not the kind, is what determines whether a panel shows one
   item or a collection. This is a stated assumption, not a resolved
   decision — confirm before T-1007-1's placeholder registrations are
   finalized.
6. **Where title/visibility/collapsed-state live.** The `update_panel`
   tool that used to own these no longer exists in the revised tool
   surface, and `configure_panel_view`'s stated purpose ("columns,
   studies, axes, sorting, grouping, formatting") does not name them.
   _Assumption:_ they are folded into `configure_panel_view` anyway, as
   the closest remaining tool, per EPIC-1007 AC3 — flagged as unresolved
   rather than settled; confirm, or a dedicated chrome-only tool may be
   warranted instead.

---

_Implemented by: EPIC-1007, hotfix/empty-grid-canvas, hotfix/panel-system
(reset-to-default feature), EPIC-0027 (drag a result onto the canvas).
Depends on the common workspace contract from EPIC-1006._
