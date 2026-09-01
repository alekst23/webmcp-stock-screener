# T-1009-4: `edit_filter_tree` structural operations

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: T-1009-1
**Blocks**: T-1009-6

## Description

`edit_filter_tree` is the tool an agent reaches for most, and the one
most likely to corrupt a screener if it gets structure wrong. This ticket
delivers its six structural operations — add, update, remove, group,
enable/disable, reorder — over arbitrarily nested `AND`, `OR`, and `NOT`
groups, with node IDs that survive every operation that does not delete
the node.

## User Story

As an AI agent refining a screen across several turns,
I want to restructure the filter tree by node ID,
so that I can add, regroup, and temporarily disable conditions without
rebuilding the whole screener and without the human losing track of which
node is which.

## Acceptance Criteria

1. Adding a condition appends a node with a new stable node ID under the
   root group, or under a named parent group when one is given, and
   returns that node ID in `affected_ids`.
2. Updating a node changes only that node; every sibling node, its ID, and
   its position are untouched.
3. Removing a node removes it, and for a group its entire subtree; every
   remaining node keeps its ID.
4. Grouping two or more existing sibling node IDs under `AND`, `OR`, or
   `NOT` replaces them in position with a new group node that contains
   them in the requested order, and the grouped nodes keep their IDs.
5. Disabling a node keeps it in the tree, reports it as disabled, and
   causes validation and execution to skip it; enabling restores it.
6. Reordering a group's children applies the requested order and changes
   no node IDs.
7. Groups nest to arbitrary depth, and a `NOT` group is rejected unless it
   holds exactly one child.
8. Any operation naming a node ID that does not exist in this screener is
   rejected, naming the unknown ID, and the tree is left unchanged.
9. Every accepted operation advances the screener revision and returns the
   mutation envelope with a `diff_summary` describing the structural
   change; a rejected operation advances nothing.
10. The tool accepts `expected_revision` and `idempotency_key`, rejects a
    stale revision without mutating, and returns the original result on a
    replayed key.
11. Tests cover each of the six operations, deep nesting, `NOT` arity,
    node-ID stability across group and reorder, unknown node IDs, and
    revision conflict.

## Design References

- `docs/design/screener-core/spec.md` — the "Edit the filter tree"
  scenario table; each AC above traces to a row.
- `docs/design/screener-core/technical.md` — `FilterNode` shape, node-ID
  stability rule, and the retired-ID-never-reused rule.
- `src/lib/webmcp/tools.ts` — existing tool description and error-shape
  conventions.

## Technical Considerations

- Tree operations should be written as pure transformations over the
  T-1009-1 model so they are testable without a workspace or a network.
- The mutation envelope and concurrency handling come from EPIC-1006.
- Condition *contents* are opaque to this ticket — it moves nodes around;
  T-1009-6 decides whether a condition is valid.

## Out of Scope

Condition types and catalog validation (T-1009-6), validation reporting
(T-1009-8), execution (T-1009-9), and registration (T-1009-10).
