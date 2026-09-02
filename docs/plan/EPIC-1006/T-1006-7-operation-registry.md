# T-1006-7: Extensible operation registry with preview and apply

**Epic**: EPIC-1006 (Workspace, Revisions & the Common Tool Contract)
**Design**: docs/design/workspace-revisions/
**Status**: Done
**Depends on**: T-1006-5
**Blocks**: T-1006-8

## Description

Nine sibling epics each define their own kinds of change — add a study,
edit a filter tree, set a ranking — and EPIC-1013 must be able to preview
and atomically apply an arbitrary collection of them. This ticket delivers
the registry that makes that possible: a typed operation definition,
registration from outside this epic's modules, a preview that validates and
describes without committing, and an apply that commits many operations as
one revision or none at all.

## User Story

As an epic adding a new kind of workspace change,
I want to register my operation and get preview, validation, atomic apply,
revision guarding and undo for free,
so that I write only my own domain logic instead of reimplementing the
common contract.

## Acceptance Criteria

1. An operation definition declares its kind, its input schema, how to
   validate an input against a workspace, how to describe it in one
   sentence, and how to apply it.
2. An operation can be registered from a module outside this epic's own
   files and immediately becomes previewable and applicable, with no change
   to the registry's source.
3. Registering two operations under the same kind is rejected rather than
   silently replacing the first.
4. Requesting an unregistered kind is reported as an unknown operation, not
   as a crash.
5. Previewing a collection of operations reports whether the collection is
   valid overall, the IDs it would affect, a combined diff summary, a
   per-operation description and its validation issues, any warnings, and
   the revision the workspace would reach.
6. A preview changes no stored state whatsoever, including when some
   operations in the collection are invalid.
7. A preview evaluates each operation against the state the preceding
   operations in the same collection would produce, so an operation acting
   on something an earlier one created validates correctly.
8. Applying a collection of operations produces exactly one new revision,
   one change ID and one undo token covering the whole collection.
9. If any operation in a collection fails validation or application,
   nothing is applied and the stored workspace is unchanged.
10. Applying a collection honors expected-revision checking and
    idempotency-key replay identically to a single mutation.
11. Undoing an applied collection reverses every operation in it as one
    change.
12. Applying an empty collection is refused with a clear reason rather than
    producing an empty revision bump.

## Design References

- `docs/reference/tool-spec.md` — the Safety rows (`preview_workspace_changes`
  and `apply_previewed_changes`) describe the behavior this engine
  provides to EPIC-1013.
- `docs/design/workspace-revisions/spec.md` — the "Growing the surface"
  and "Several changes commit as one" scenarios.
- `docs/design/workspace-revisions/technical.md` — "T-1006-7" section for
  `OperationDefinition`, `OperationRegistry`, `previewOperations`,
  `applyOperations`.

## Solution Approach

`createOperationRegistry()` is a `Map<kind, OperationDefinition>`;
`register` validates `kind` matches `/^[a-z_]+\.[a-z_]+$/` (namespace
shape, AC per Technical Considerations) and throws on both a malformed
kind and a duplicate registration (AC3) rather than silently replacing.
The shared `operationRegistry` instance is just
`createOperationRegistry()` exported at module scope; tests always build
their own via the factory (per the ticket's own warning about
order-dependent tests).

`previewOperations(ops, deps)` folds each `OperationRequest` over an
in-memory copy of the current document **in order** — `validate` and
`describe` for operation N see the document as operation N-1 left it
(AC7) — accumulating `perOperation` entries, `affectedIds`, and an overall
`valid` flag; an unregistered `kind` becomes a per-operation issue
("unknown operation: <kind>"), not a thrown error, so the rest of the
collection still previews. No repository write ever happens here (AC6).

`applyOperations(ops, context, deps)` rejects an empty array up front
(AC12), then does the same in-order fold to build one combined
`MutationDraft` — `document` is the final folded state, `affectedIds` is
the union in operation order, `diffSummary` joins each op's `describe()`,
and `inverse` is the per-operation inverses **reversed** (last operation's
inverse applied first) chained into one draft — and calls
`deps.revisionService.commit({ mutate: () => combinedDraft })` exactly
once, so `expected_revision`/idempotency and the single-envelope guarantee
fall out of T-1006-5 for free (AC8/AC10). Any operation's `validate`
returning issues, or its `apply` throwing, aborts before `commit` is
called — nothing is applied (AC9).

**Contracts introduced:** `OperationDefinition<T>`, `OperationRegistry`,
`createOperationRegistry`, `operationRegistry`, `OperationRequest`,
`PreviewResult`, `previewOperations`, `applyOperations` —
`src/lib/workbench/application/operationRegistry.ts`.

## Technical Considerations

- Module: `src/lib/workbench/application/operationRegistry.ts`.
- Exported contract surface other epics depend on — this is the most
  widely imported surface in the epic: `OperationDefinition<T>`,
  `OperationRegistry`, `createOperationRegistry`, the shared
  `operationRegistry` instance, `OperationRequest`, `PreviewResult`,
  `previewOperations`, `applyOperations`.
- Operation kinds must be namespaced (`chart.add_study`,
  `screener.edit_filter_tree`) so nine epics registering into one registry
  do not collide. Enforce the namespace shape at registration.
- Fold operations over an in-memory copy of the document and commit once
  through T-1006-5's revision service — that is what makes atomicity and
  the single-envelope guarantee fall out rather than needing rollback
  logic.
- The combined inverse for a collection is the per-operation inverses in
  reverse order; getting the order wrong makes multi-operation undo produce
  wrong state, so test it explicitly with two operations that touch the
  same panel.
- A shared mutable module-level registry instance is convenient but makes
  tests order-dependent. Export the factory too, and have tests build their
  own registry rather than mutating the shared one.
- Input schemas use snake_case property names, matching the agent-facing
  contract.

## Out of Scope

The `preview_workspace_changes` and `apply_previewed_changes` tools
themselves, and persisting a preview for later application by token —
EPIC-1013 owns both. This ticket delivers the engine they call. No domain
operations are registered here; sibling epics register their own.
