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

Panel *contents* are not this feature's concern. What lives inside a
chart, a screener, a results table, or a similarity panel is owned by
separate features; this feature owns the container, the layout, the
links, and the typed registry those features plug their panel kind into.

## Preconditions

- A workspace exists, with a current revision, stable-ID scheme, mutation
  envelope, and undo support (the common workspace contract — EPIC-1006).
- Every mutation here accepts `expected_revision` and `idempotency_key`
  and returns the standard mutation envelope.

## Features

1. **Add a panel** of a supported kind to the workspace.
2. **Update a panel's** title, configuration, visibility, collapsed
   state, or bound resource.
3. **Lay out panels** on a logical grid — position and size in grid
   cells, never pixels.
4. **Link panels** so that a change in one propagates to the others on a
   named channel.
5. **Remove a panel** by its stable ID.
6. **Register a panel kind** so a new kind of panel becomes addable
   without changing the panel container itself.

## Supported panel kinds

`filter_builder`, `chart`, `study_library`, `results_table`,
`similar_opportunities`, `watchlist`, `alerts`, `symbol_details`.

## Link channels

`symbol`, `timeframe`, `result_selection`, `crosshair`, `filters`.

## Behavioral Specifications

### Add a panel

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a workspace | the agent adds a panel of a supported kind | a panel of that kind exists with a new stable ID, its kind's default title, default configuration, and a non-overlapping default position and size on the grid; the mutation envelope names the new panel |
| Explicit placement | a workspace | the agent adds a panel and supplies a grid position and size | the panel is created at exactly that position and size, if it is valid and unoccupied |
| Unknown kind | a workspace | the agent adds a panel of a kind that is not registered | the call fails, changes nothing, and the error lists every kind that *is* registered |
| Invalid configuration | a workspace | the agent adds a panel with configuration its kind rejects | the call fails, changes nothing, and the error says which configuration values were rejected and why |
| No room at the requested spot | a panel already occupies the requested cells | the agent adds a panel there | the call fails with an overlap error naming the occupying panel, and nothing is created |
| Replay | a mutation was already applied under an idempotency key | the same call is repeated with that key | the original result is returned and no second panel is created |

### Update a panel

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Retitle | an existing panel | the agent sets a new title | only the title changes; the panel keeps its ID, kind, configuration, and position |
| Reconfigure | an existing panel | the agent supplies new configuration for the panel's kind | the configuration is validated against that kind and, if valid, replaces or merges into the panel's configuration |
| Hide and show | a visible panel | the agent hides it | the panel remains in the workspace with its position and configuration intact, but is not rendered; showing it again restores it in place |
| Collapse | an expanded panel | the agent collapses it | the panel renders as a header only, retains its stored size, and expanding restores that size |
| Rebind | a panel bound to a resource | the agent binds it to a different resource of a compatible type | the panel shows the newly bound resource; an incompatible resource type is rejected without changing the panel |
| Unknown panel | no panel with the given ID | the agent updates it | the call fails, changes nothing, and says the ID is unknown |
| Stale revision | the workspace has advanced past the caller's `expected_revision` | the agent updates a panel | the call is rejected as a conflict and nothing changes |

### Lay out panels

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Move and resize | one or more existing panels | the agent sets grid positions and sizes for them | all of them move/resize together as one change, or none of them do |
| Below minimum size | a panel kind that declares a minimum size | the agent sets a smaller size | the call fails naming the minimum, and no panel moves |
| Out of bounds | the grid's column count | the agent places a panel past the last column | the call fails naming the grid bounds, and no panel moves |
| Overlap within one call | a batch of placements | two of them would occupy the same cell | the whole call fails identifying the conflicting pair, and no panel moves |
| Partial ID set | a workspace with several panels | the agent lays out only some of them | the named panels move; the unnamed panels stay exactly where they are |
| Unaffected by hidden panels | a hidden panel occupying cells | the agent places a visible panel over those cells | the placement is accepted — hidden panels reserve their stored position but do not block placement |

### Link panels

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | two panels that both support a channel | the agent links them on that channel | changing the linked value in either panel propagates to the other |
| Multi-panel group | a link group on a channel | the agent links a third panel into it | all three share the channel's value, and the value in force is the group's current one |
| Unsupported channel | a panel whose kind does not participate in a channel | the agent links it on that channel | the call fails naming the channel and the kind, and no link is created |
| Unlink | linked panels | the agent unlinks one of them from a channel | that panel stops receiving and emitting on that channel; the remaining panels stay linked to each other |
| Independent channels | panels linked on one channel | the agent links a different pair on another channel | the two channels' groups are independent; a change on one does not propagate through the other |
| Self-link | one panel | the agent links a panel to itself | the call fails and nothing changes |
| Duplicate link | panels already linked on a channel | the agent links them again on that channel | the call succeeds without creating a duplicate, and the envelope reports no effective change |

### Remove a panel

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | an existing panel | the agent removes it by ID | the panel is gone from the workspace, its grid cells are freed, and the envelope names it as affected |
| Link cleanup | a panel in one or more link groups | the agent removes it | it is dropped from every link group; a group left with fewer than two panels is dissolved, and the remaining panels are named as affected |
| Unknown panel | no panel with the given ID | the agent removes it | the call fails, changes nothing, and says the ID is unknown |
| Undo | a removed panel | the agent undoes the removal with the returned undo token | the panel returns with its ID, kind, title, configuration, position, size, and link memberships as they were |

### Register a panel kind

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a feature that owns a panel kind | it registers that kind with a title, default and minimum size, default configuration, a configuration validator, the link channels it participates in, and a body to render | panels of that kind can be added, configured, laid out, linked, and rendered without any change to the panel container |
| Discovery | a set of registered kinds | the agent asks what kinds are available | every registered kind is listed with the configuration it accepts and the link channels it supports |
| Duplicate kind | a kind already registered under a name | the same name is registered again | the conflict is reported rather than silently overwriting the first registration |

## Non-Goals

- The contents of any panel — the filter builder's tree, the chart's
  studies, the results table's columns, the similarity search — all owned
  by separate features.
- The shared workspace/revision model, stable-ID scheme, mutation
  envelope, `expected_revision`, `idempotency_key`, and undo tokens —
  owned by EPIC-1006 and consumed here.
- Pixel-level layout, drag-to-resize gestures, and responsive breakpoint
  behavior beyond mapping the logical grid onto the viewport.
- Saving/restoring named workspace revisions.
- Retiring the existing 11-tool pattern-research surface — the panel
  system is built alongside it in new files.

## Open Questions

1. **Grid dimensions.** The tool spec says "logical grid coordinates
   rather than pixels" but does not fix a column count.
   *Assumption:* a fixed 12-column grid with unbounded rows; row height
   is a rendering concern, not part of the model.
2. **Link directionality.** The tool spec does not say whether a link is
   directed (source → target) or symmetric.
   *Assumption:* symmetric per channel — `link_panels` maintains
   undirected link *groups*, one per channel, since "synchronize" reads
   as mutual.
3. **Bound resource types.** "Bound resource" is not enumerated.
   *Assumption:* an opaque typed reference (`{ type, id }`) to a stable
   ID owned by another feature — screener, run, instrument, watchlist,
   captured setup — validated by the panel kind, not by the container.
4. **Overlap policy.** The spec does not state whether panels may
   overlap.
   *Assumption:* they may not; overlapping placements are rejected rather
   than auto-reflowed, so the agent gets a clear error instead of a
   surprising rearrangement.
5. **Hidden vs. removed.** The spec lists visibility as an `update_panel`
   field, implying hiding is not removal.
   *Assumption:* a hidden panel keeps its ID, configuration, links, and
   stored position, and does not reserve grid space against new
   placements.

---

*Implemented by: EPIC-1007. Depends on the common workspace contract from
EPIC-1006.*
