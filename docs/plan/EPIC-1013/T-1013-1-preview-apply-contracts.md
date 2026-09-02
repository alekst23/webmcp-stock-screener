# T-1013-1: Preview and apply domain contracts

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Done
**Depends on**: — (consumes EPIC-1006's registry and envelope types)
**Blocks**: T-1013-2, T-1013-3, T-1013-4

## Description

Define the pure data contracts the rest of the epic is built from: what a
proposed change batch is, what a preview result contains, how validation
failures and warnings are represented, and what errors preview and apply
can return. No behavior, no I/O — just the vocabulary, so the three Wave 2
tickets can be built in parallel against a shared shape.

## User Story

As a developer implementing evaluation, diffing, and preview storage in
parallel,
I want one agreed set of types for batches, previews, diffs, and failures,
so that the three pieces compose without rework and the tool layer has a
single payload shape to serialize.

## Acceptance Criteria

1. A proposed change batch is representable as an ordered collection of
   operations, each carrying an operation kind and its typed arguments,
   with the batch's ordering significant.
2. An operation's kind is expressed as a registry key, not a member of a
   closed enumeration — adding a kind requires no change to these types.
3. A preview result is representable with: a stable preview ID, the
   revision it was computed against, a structured diff, the affected
   stable IDs, a human-readable summary, warnings, per-operation outcomes,
   and whether the preview is applicable.
4. A validation failure identifies the offending operation by its position
   in the batch and its kind, and carries a human-readable reason; a batch
   can hold more than one.
5. Warnings and failures are distinct types — a preview carrying only
   warnings is applicable; one carrying any failure is not.
6. A structured diff is representable as an ordered list of typed entity
   changes (added, removed, updated), each naming the entity's stable ID,
   with updates carrying the changed fields' before and after values.
7. The error cases preview and apply can return are enumerable and
   distinguishable by a caller: unknown preview, expired preview, stale
   revision, precondition mismatch, already applied, not applicable, and
   invalid input.
8. The contracts are pure data with no imports from any infrastructure or
   UI module, and no dependency on the existing eleven-tool surface.

## Design References

- `docs/design/safety-preview-apply/spec.md` — the guarantees these types
  must be able to express, and the scenario tables they must cover
- `docs/design/safety-preview-apply/technical.md` — "Diff shape" and the
  layering table
- `docs/reference/tool-spec.md` — the common mutation contract these types
  interoperate with
- `src/lib/webmcp/types.ts` — the project's existing convention for
  declaring a tool surface's data contracts

## Technical Considerations

Consume EPIC-1006's operation-registry and mutation-envelope types rather
than restating them; if EPIC-1006 has not landed the exact names yet,
depend on the capability and adapt when it does. Types only — anything
that reads a clock, generates an ID, or touches storage belongs to a later
ticket.

## Out of Scope

Evaluation, diffing, storage, and tool registration.

## Implementation Plan

Two new pure-data modules in the domain layer, each with a sibling test
file. No existing source file is touched.

### `src/lib/workbench/domain/preview.ts`

Pure types plus a handful of total, side-effect-free helpers. Type-only
imports: `ResourceId` from `./ids`, `Revision` and `WorkspaceDocument`
from `./workspace`. Nothing from `infra/`, `src/lib/webmcp/`,
`src/lib/workspace/` or `src/lib/surface/` (AC8).

- `ProposedOperation` — `{ kind: string; input: unknown }`. `kind` is a
  registry key typed as a bare `string`, deliberately not a union, so a
  kind registered by a later epic needs no edit here (AC2). `input` is
  `unknown` because only the kind's registered validator knows its shape.
- `ChangeBatch = ProposedOperation[]` — a plain array, so ordering is the
  array's own ordering and is structurally significant (AC1). No set, no
  keyed map: two batches with the same operations in different orders are
  different batches, and the fold in T-1013-2 evaluates left to right.
- `OperationFailure` — `{ index; kind; reason }` (AC4). `index` is the
  operation's position in the batch, which is how a caller points at the
  offending operation without needing the operation to carry an ID.
- `OperationWarning` — `{ index; kind; message }`. A separate interface
  from `OperationFailure`, not a severity flag on one type, so
  applicability can never be computed from a mis-set enum (AC5).
- `OperationOutcome` — `{ index; kind; describe; failures; warnings }`,
  the per-operation slice of the result (AC3). Holds its own failures and
  warnings so a caller can render per-operation detail without filtering
  the batch-level lists by index.
- Diff types (AC6, and T-1013-3 AC10): `DiffChangeType`
  (`'added' | 'removed' | 'updated'`), `FieldChange`
  (`{ field; before; after }`), `DiffEntry`
  (`{ change; entityType; id; fields }`) and `WorkspaceDiff = DiffEntry[]`.
  `entityType` is a free string, not a union, so entity kinds contributed
  by sibling epics (panel, link, workspace, or an `extensions` key) need
  no edit here. `fields` is `[]` for added/removed and lists only the
  fields that actually changed for `updated`.
- `PreviewResult` — `{ previewId; baseRevision; diff; affectedIds;
  summary; warnings; failures; outcomes; applicable }` (AC3, AC5).
- `PreviewRecord` — `{ previewId; baseRevision; candidate; result }`,
  where `candidate` is a `WorkspaceDocument`. This is the value T-1013-4's
  store persists; it lives here because apply commits the state preview
  already computed rather than recomputing it, which is what makes the
  honesty guarantee structural (technical.md, "one evaluation path").
- Helpers, all pure and total: `isApplicable(failures)` (empty failures ⇒
  applicable, so warnings alone never block — AC5),
  `collectAffectedIds(diff)` (deduped, first-appearance order, per
  technical.md's "Diff shape"), and `buildPreviewResult(input)` deriving
  `affectedIds` and `applicable` from the diff and failures rather than
  letting a caller pass an inconsistent pair.
- `toWirePreviewResult(result)` → `WirePreviewResult`, the sole
  snake_case emitter here, mirroring `toWireEnvelope` in `mutation.ts`:
  `preview_id`, `base_revision`, `diff`, `affected_ids`, `diff_summary`,
  `warnings`, `failures`, `per_operation`, `applicable`. Nested failures,
  warnings, outcomes and diff entries serialize to snake_case too
  (`entity_type`, `change`, `fields`, `describe`), because the tool layer
  in T-1013-6 hands this straight to a caller.

### `src/lib/workbench/domain/previewErrors.ts`

- `SafetyErrorReason` union of the seven cases in AC7, plus
  `SAFETY_ERROR_REASONS` as a `readonly` array so the set is enumerable
  by a caller and by tests.
- `class SafetyError extends Error` with `readonly reason` and a private
  `details` record, kept under 120 lines by pushing every case-specific
  field into `details` instead of into named class properties. Its
  `toWireError(): WireError` returns `{ error: reason, message,
  ...details }` — `error` is the reason itself, so a caller can branch on
  the wire payload exactly as it branches on `instanceof` + `.reason`.
  `WireError` is imported type-only from `./errors` so the shape matches
  EPIC-1006's convention.
- Static named constructors carrying the case-specific fields:
  `unknownPreview`, `expiredPreview`, `staleRevision` (message names both
  revisions; wire fields `previewed_revision` / `current_revision`),
  `preconditionMismatch`, `alreadyApplied`, `notApplicable` (carries the
  `OperationFailure[]`), `invalidInput`. Factories rather than a wide
  constructor so an impossible pairing (e.g. an `expired_preview` with
  revision fields) cannot be constructed.

### Tests

`preview.test.ts` covers: batch ordering being significant and preserved;
`kind` accepting a key the module never mentions; a `PreviewResult`
carrying every AC3 field; a batch holding several failures at distinct
indices; warnings-only staying applicable while any failure is not;
`DiffEntry` shapes for added/removed/updated with `updated` listing only
changed fields; `collectAffectedIds` deduping in first-appearance order;
and the exact snake_case wire mapping including nested entries.

`previewErrors.test.ts` covers: each reason distinguishable via
`instanceof SafetyError` + `.reason` and via `toWireError().error`;
`SAFETY_ERROR_REASONS` containing exactly the seven reasons and every
factory being represented in it; `staleRevision` naming both revisions in
its message and its wire fields; `notApplicable` carrying its failures;
and `SafetyError` being a real `Error` (has a stack, is catchable).

Every assertion gets a message as `expect`'s second argument.

### Verification

`npx prettier --write "src/lib/workbench/**/*.ts"`, then `npm test` and
`npm run typecheck` must both be clean.
