# T-1007-3: Panel link graph

**Epic**: EPIC-1007 (Panel System)
**Design**: docs/design/panel-system/
**Status**: Open
**Depends on**: —
**Blocks**: T-1007-4

## Description

What makes a multi-panel workbench worth having is that the panels stay
in sync: click a row in the results table and the chart follows; change
the timeframe on one chart and the comparison chart matches. `link_panels`
is the tool that establishes those relationships, over five named
channels — symbol, timeframe, result selection, crosshair, and filters.

This ticket delivers the link graph behind it: per-channel undirected
groups, the rules for joining and leaving them, and the resolution of who
receives a broadcast from a given source panel.

Done looks like: a pure, unit-tested link graph module with no knowledge
of panel contents, geometry, or WebMCP.

## User Story

As a researcher,
I want the panels I connect to stay synchronized on exactly the aspect I
connected them on,
so that selecting a result or changing a symbol updates the panels that
should follow it and leaves the ones that should not alone.

## Acceptance Criteria

1. Two or more panels can be joined on any of the five channels —
   `symbol`, `timeframe`, `result_selection`, `crosshair`, `filters` —
   and the resulting relationship is symmetric: a change in any member
   reaches every other member.
2. Joining a panel to an existing group on a channel merges it into that
   group rather than creating a second one, and the group's current value
   is the one that takes effect.
3. Groups on different channels are independent: a panel may belong to
   several channels' groups, and propagation on one channel never reaches
   the members of another.
4. Linking a panel on a channel its kind does not declare support for is
   rejected with an error naming both the channel and the kind, and no
   link is created.
5. Linking a panel to itself is rejected and nothing changes.
6. Re-linking panels already grouped on a channel succeeds without
   creating a duplicate and reports that nothing effectively changed.
7. A panel can be removed from a channel's group; the remaining members
   stay linked to each other, and a group left with fewer than two
   members is dissolved.
8. A panel can be dropped from every channel at once, for use when the
   panel is removed from the workspace, and the panels affected by the
   resulting group changes are identifiable.
9. Given a channel and a source panel, the set of panels that should
   receive the broadcast is every other member of that channel's group
   and no one else — the source is never included.

## Design References

- `docs/design/panel-system/spec.md` — "Link panels" scenarios and Open
  Question 2 (link directionality)
- `docs/design/panel-system/technical.md` — the link graph contract table

## Technical Considerations

- Pure functions over an immutable graph value; no state, no I/O, no
  imports from the layout module, WebMCP, or Svelte. A panel's supported
  channels are passed in as data rather than looked up in the registry,
  so this module stays independent of T-1007-1 and can be built in
  parallel with it.
- Because groups are undirected, propagation cannot cycle — but merging
  two existing groups on the same channel must not duplicate members;
  test the merge case with overlapping groups.
- New files only.

## Out of Scope

Applying a propagated value to a panel's configuration — the panel kind
does that, wired in T-1007-6. Also: the registry (T-1007-1), geometry
(T-1007-2), and revision/envelope handling (T-1007-4).

## Solution Approach

One new file, `src/lib/panels/domain/links.ts`, exporting exactly the
API Wave 2 depends on. `PanelLinkGraph.groups` is a flat array; every
mutator filters/copies it rather than touching the input arrays or group
objects, so `cloneGraph` (a fresh `{ groups: [...] }`) is used even on the
no-op paths — the ticket's "every function returns a NEW graph value"
is read literally, not just as "never mutates."

- **`changed: false` split.** `removePanelFromGraph` reports
  `changed: false` when the panel was in no group on any channel (it is
  a blanket cleanup call, called unconditionally on every `remove_panel`,
  so "nothing to do" is a normal outcome, not an error). `unlinkPanel`
  instead fails with `not_linked` when the panel is in no group on the
  named channel — it is a targeted, explicit request naming one channel,
  so acting on a channel the panel was never part of is the caller's
  mistake to surface, per the ticket's explicit instruction.
- **`self_link` covers both shapes.** `linkPanels` dedupes `panelIds`
  first; fewer than two *distinct* ids after dedup is a `self_link`
  failure regardless of whether the input was `['A']` or `['A', 'A']`.
  `panelId` on the failure is the one repeated/lone id (or `''` for an
  empty input, an untested edge the type system doesn't prevent).
- **Group id retention on merge.** `nextGroupId()` is documented as
  minting ids for "newly formed" groups, so it is called only when a
  link actually creates a new group identity: zero pre-existing groups
  on the channel (brand new group), or two-or-more pre-existing groups
  colliding into one (their separate identities dissolve into a new
  one). Extending exactly one pre-existing group with additional
  members keeps that group's `id` — the group is still "the same
  group," just with more panels, which matches the spec's "Multi-panel
  group" scenario reading of joining a third panel into an existing
  group rather than replacing it.
- **`affectedPanelIds` for `linkPanels`** (not spelled out in the
  contract table, unlike the other three functions): the full merged
  group's `panelIds` when `changed` is `true` — including panels not
  named in the call, since a merge can pull in a whole second group's
  membership and callers need to know who now shares the channel — and
  `[]` when `changed` is `false`, consistent with "nothing changed" also
  meaning "nothing to report."
- **Determinism.** `panelIds` on every group, and every `string[]`
  returned as `affectedPanelIds`, goes through `[...new Set(ids)].sort()`
  — plain lexicographic sort. It's a determinism guarantee for
  diffing/testing, not a numeric ordering guarantee.
- Small private helpers: `sortedUnique`, `cloneGraph`, `validatePanel`
  (the `unknown_panel`/`unsupported_channel` check shared by every named
  panel in a `linkPanels` call, returning the first failure so
  validation happens before any mutation — "all-or-nothing").
- Kept out: no reference to panel kind registry, grid, WebMCP, or
  Svelte; `LinkContext` is the only place `kind`/`channels` data enters,
  exactly as the ticket specifies.
