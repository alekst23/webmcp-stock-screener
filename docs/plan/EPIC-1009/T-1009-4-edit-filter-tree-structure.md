# T-1009-4: `edit_filter_tree` structural operations

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Done
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

## Solution Approach

### Modules

**`src/lib/screener/filterTree.ts`** (domain, pure — no import from
`src/lib/webmcp/` or `src/lib/workbench/tools|application`). Operates on
T-1009-1's `FilterNode` union and mints node IDs via the injected
`IdSequencer`, mirroring `definition.ts`'s `createScreener(ids, ...)`
style so id-minting stays deterministic and testable without a workspace.

Shared internal (unexported) tree helpers: `findNode`, `collectNodeIds`,
`transformNodeById` (replace one node in place, used by update/setEnabled),
`transformGroupChildren` (replace one group's children array, used by
add/reorder/group), `removeNodeById` (splice a node and its subtree out of
wherever it lives), `locateSiblingParent` (find the group whose direct
children are exactly a given id set). Every helper rebuilds only the path
from root to the target, immutably — a rejected operation never touches
the input tree, so the caller's reference is safe to reuse.

Result shape every operation returns instead of throwing (AC-driven: a
rejection must be inspectable, not a control-flow exception, so the tool
layer can turn it into `OperationValidationError`'s issues list):

```ts
export type FilterTreeOpResult =
	| { ok: true; tree: FilterNode; affectedIds: ResourceId[]; diffSummary: string }
	| { ok: false; message: string; validNodeIds?: ResourceId[] };
```

`validNodeIds` is populated only for an unknown-node-id rejection (AC8's
self-correction convention, matching `ExpressionError`'s catalog and
`search_catalog`'s "no matches" note).

**`src/lib/webmcp/screener/editFilterTree.ts`** (tool layer). Exports
`createEditFilterTreeTool(deps: WorkbenchDeps): ToolSpec` for the
`edit_filter_tree` tool. One wire-facing `operation` enum
(`add | update | remove | group | set_enabled | reorder`) dispatches to
the matching pure function. Routes through `recordCommit` +
`RevisionService.commit` exactly as `src/lib/workbench/tools/index.ts`
does (private local copies of `toErrorResult`/`resolveWorkspaceId`, per
the ticket's instruction not to modify `index.ts`). Inside `mutate(doc)`:
read the screener via `readScreener`, run the pure operation, `throw new
OperationValidationError([...])` on rejection (so `commit()`'s existing
"mutate() throws ⇒ nothing persists" guarantee gives AC9 for free — no
new revision-guarding logic needed here), otherwise bump
`screener.revision` (screener-local counter — a comment marks this as
distinct from the `WorkspaceDocument.revision` that `commit()` advances
via `expected_revision`) and `writeScreener` the result back into the
document.

`condition` input is parsed with the existing `normalizeCondition` from
T-1009-1's `conditions.ts`; a `null` result (structurally unparseable —
not a catalog-validity question, which is T-1009-6's job) is rejected the
same way an unknown node id is, before the pure operation ever runs.

### Exported functions (all in `filterTree.ts` unless noted)

```ts
function addFilterNode(tree, ids: IdSequencer, input: { parentNodeId?: ResourceId; condition: Condition }): FilterTreeOpResult
function updateFilterCondition(tree, input: { nodeId: ResourceId; condition: Condition }): FilterTreeOpResult
function removeFilterNode(tree, input: { nodeId: ResourceId }): FilterTreeOpResult
function groupFilterNodes(tree, ids: IdSequencer, input: { nodeIds: ResourceId[]; op: GroupOp }): FilterTreeOpResult
function setFilterNodeEnabled(tree, input: { nodeId: ResourceId; enabled: boolean }): FilterTreeOpResult
function reorderFilterChildren(tree, input: { parentNodeId?: ResourceId; orderedNodeIds: ResourceId[] }): FilterTreeOpResult

// editFilterTree.ts
function createEditFilterTreeTool(deps: WorkbenchDeps): ToolSpec
```

### Key design decisions

- **Grouping position**: the new group node lands at the *original* index
  of whichever grouped id came first in the parent's current child order
  (not the order requested for grouping); its own children follow the
  requested order. Since that original index only counts elements smaller
  than every grouped id's index, and none of those precede a grouped
  element, splicing the grouped set out and inserting at that same index
  is correct without an adjustment pass.
- **`NOT` arity vs. "two or more"**: AC4 requires grouping at least two
  sibling ids; AC7 requires a `NOT` group to hold exactly one child. The
  two constraints intersect at nothing — `groupFilterNodes` enforces both
  literally, so `group_op: 'not'` is always rejected through this
  operation (consistent with technical.md: nothing in this ticket's scope
  offers another path to mint a single-child `NOT` group). Tested
  explicitly so this isn't mistaken for a bug later.
- **Root protection**: `removeFilterNode` and `groupFilterNodes` both
  reject when the root node id is named, since removing/absorbing the
  root has no defined parent to operate on.
- **Update scope**: `updateFilterCondition` only targets condition nodes;
  naming a group node is rejected (structural edits to a group go through
  group/reorder/setEnabled instead).
- **No undo wiring**: no AC in this ticket calls for undo, so `mutate()`'s
  draft omits `inverse` and `undo_token` is `null` — matches
  `create_workspace`'s existing precedent in `tools/index.ts`.

### Test plan

`filterTree.test.ts` (pure, no workspace) — one `describe` per operation
plus cross-cutting cases:
- add: under root by default; under a named parent; unknown parent
  rejected with `validNodeIds`; parent that is a condition node rejected.
- update: changes only the target condition, siblings/ids/positions
  untouched; rejects a group node id; rejects unknown node id.
- remove: removes a leaf; removes a group's whole subtree (descendant ids
  gone); rejects removing the root.
- group: two+ siblings regrouped in requested order under `and`/`or`,
  original ids preserved, new group lands at the first grouped sibling's
  original position; rejects `not` with 2+ ids (arity); rejects
  non-sibling ids; rejects an unknown id; rejects fewer than two ids.
- setEnabled: toggles without touching id/position; rejects unknown id.
- reorder: applies requested permutation; rejects a set that adds,
  drops, or duplicates an id relative to the current children.
- deep nesting: 3+ levels of mixed `and`/`or`/`not` groups; operations
  addressed by a deeply nested node id still resolve correctly.
- node-ID stability: capture every id before/after a group then a
  reorder on the new group's own children; the id set is unchanged.

`editFilterTree.test.ts` (tool layer, `WorkbenchDeps` built from real
`createIdSequencer`/`createIdempotencyCache`/`createRevisionService`/
`createChangeHistory` plus `createLocalWorkspaceRepository(memoryStorage())`
from `infra/workspaceRepository.ts` + `testSupport.ts` — the same
composition `workbench/tools/index.test.ts` already uses, so no new fake
repository is written):
- each operation end-to-end: mutation envelope shape, `affected_ids`,
  `diff_summary`, and the persisted screener actually changed.
- unknown node id → `operation_validation_error` with an issue naming
  the id and one listing valid ids; workspace revision unchanged.
- `not` with 2+ ids → rejected, tree and revision unchanged.
- unknown `screener_id` → rejected, revision unchanged.
- stale `expected_revision` → `revision_conflict`, nothing mutated.
- repeated `idempotency_key` → same `change_id`, operation not applied
  twice.
- deep nesting and node-ID stability, exercised once each through the
  tool to prove the wiring (not just the pure functions) preserves them.
