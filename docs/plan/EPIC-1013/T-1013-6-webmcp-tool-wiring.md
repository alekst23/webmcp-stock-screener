# T-1013-6: Wire the two safety tools into the WebMCP surface

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Done
**Depends on**: T-1013-5
**Blocks**: —

## Description

Expose `preview_workspace_changes` and `apply_previewed_changes` on the
new WebMCP tool surface with typed input schemas, and prove the whole
safety layer end to end from a tool call rather than only at the use-case
boundary. This is the epic's wiring ticket — after it, an agent connected
to the app can gate its own changes.

## User Story

As an AI agent connected to the workbench,
I want the preview and apply tools to appear on the tool surface with
schemas that tell me how to describe a proposed batch,
so that I can propose changes, read the diff, and commit them without
guessing the payload shape.

## Acceptance Criteria

1. `preview_workspace_changes` and `apply_previewed_changes` are
   registered on the new tool surface and appear in its tool listing.
2. `preview_workspace_changes` accepts an ordered batch of operations,
   each naming a registered operation kind and its arguments, and returns
   the preview payload as structured, parseable content.
3. `apply_previewed_changes` accepts a preview ID plus the optional
   `expected_revision` and `idempotency_key` from the common mutation
   contract, and returns the common mutation envelope.
4. The tool descriptions and the operation-kind schema are generated from
   the live registry, so kinds contributed by other epics are described to
   the agent without editing this code.
5. An operation kind absent from the registry is reported as a validation
   failure in the preview result; it is never forwarded to any handler and
   never executed.
6. Every failure case — unknown preview, expired preview, stale revision,
   precondition mismatch, already applied, not applicable, invalid input —
   returns a tool error whose message identifies which case occurred, and
   mutates nothing.
7. An end-to-end test drives preview then apply through the tool interface
   and asserts the applied envelope matches the preview's reported diff,
   affected IDs, and summary.
8. An end-to-end test registers an operation kind that this epic's source
   never references and drives it through both tools successfully.
9. No tool accepts free-form state, code, SQL, JavaScript, or DOM
   instructions; the only mutating input either tool takes is a batch of
   registered typed operations or a preview ID.
10. The existing eleven-tool pattern-research surface, its workspace
    store, and the current UI are unchanged, and the app still builds and
    passes its existing tests.

## Design References

- `docs/reference/tool-spec.md` — the two Safety-row tool names and the
  exclusion list this ticket must honour
- `docs/design/safety-preview-apply/spec.md` — the scenario tables the
  end-to-end tests should mirror
- `src/lib/webmcp/register.ts` — the registration and ownership pattern
  (generation tracking, dispose semantics) to stay consistent with
- `src/lib/webmcp/tools.ts` — `ok`/`fail` result shaping and schema
  declaration conventions
- `src/lib/webmcp/integration.test.ts` — the existing end-to-end test
  pattern against a fake bridge

## Technical Considerations

New files only. The registration surface these tools join is EPIC-1006's;
do not add them to the existing `buildTools` list, which EPIC-1015 retires.

## Out of Scope

Any UI for reviewing a pending preview; retiring the old tool surface
(EPIC-1015).

## Implementation Plan

**New file `src/lib/workbench/tools/safetyTools.ts`** — mirrors the shape of
`tools/index.ts` but wraps `previewWorkspaceChanges`/`applyPreviewedChanges`
from `application/safetyUseCases.ts` instead of reimplementing anything:

- `SafetyToolDeps` is `SafetyDeps` re-exported under the tools-layer name the
  ticket asks for (`export interface SafetyToolDeps extends SafetyDeps {}`).
- `buildSafetyTools(deps)` builds both tool descriptions/schemas by calling
  `deps.registry.kinds()` at call time — never at module load — so a
  registry populated after this module is imported (sibling epics importing
  later, or a fresh registry built for a test) is reflected. No kind string
  is hard-coded anywhere in the file; a source-scan test enforces this the
  same way `batchEvaluation.test.ts` does with `?raw`.
- `preview_workspace_changes`: input `{ operations: [{ kind, arguments }],
  workspace_id? }`. A small mapper turns wire `arguments` into
  `ProposedOperation.input` and builds a `ChangeBatch`; malformed shape
  (non-array, missing `kind`) raises `SafetyError.invalidInput` through the
  same error path as everything else — never forwarded to a handler. An
  unregistered kind is *not* special-cased here: `evaluateBatch` (via
  `previewWorkspaceChanges`) already turns it into a per-operation failure
  inside an otherwise-successful preview result (AC5), so this file must not
  duplicate or defeat that. Success path: `ok(toWirePreviewResult(result))`.
- `apply_previewed_changes`: input `{ preview_id, expected_revision?,
  idempotency_key? }`, mapped straight into `applyPreviewedChanges`'s input
  shape. Success path: `ok(toWireEnvelope(envelope))`.
- Error mapping: a local `toErrorResult` (not imported from `tools/index.ts`,
  which this ticket must touch minimally) catches `SafetyError` plus
  EPIC-1006's `RevisionConflictError`, `IdempotencyConflictError`,
  `StorageWriteError`, `OperationValidationError`, `UndoTokenError` and
  returns `fail(err.message, err.toWireError())`; anything else falls back to
  `fail(message)`. This covers all seven `SafetyErrorReason` values because
  every `SafetyError` factory sets `.reason` and `.toWireError().error`
  echoes it.
- No `state`/code/SQL/JS/DOM field anywhere in either schema (AC9) — the only
  inputs are the typed operation batch and a preview id.

**Modify `registerWorkbenchTools.ts`** — minimally:

- Import `createPreviewStore` (`infra/previewStore`) and `buildSafetyTools`,
  `type SafetyToolDeps` (`./safetyTools`).
- `createDefaultWorkbenchDeps()`'s return type becomes
  `WorkbenchDeps & Pick<SafetyToolDeps, 'previews'>` (a local intersection,
  not an edit to `WorkbenchDeps` itself in `tools/index.ts`), and the
  function body adds `previews: createPreviewStore({ clock })` using the
  same `clock` already built for the rest of the deps. `WorkbenchDeps`
  already carries every other field `SafetyDeps` needs (repository,
  revisions, history, registry, idempotency, clock, ids), so the
  intersection satisfies both `WorkbenchDeps` and `SafetyDeps` structurally.
- `registerWorkbenchTools()`'s parameter type and default follow the same
  intersection type, and the tool loop registers
  `[...buildWorkbenchTools(deps), ...buildSafetyTools(deps)]` instead of only
  `buildWorkbenchTools(deps)`. `WORKBENCH_TOOLS_ENABLED` is untouched.

**Tests (`safetyTools.test.ts`)** — build fresh deps per test the same way
`safetyUseCases.test.ts` does (`createOperationRegistry()`,
`createLocalWorkspaceRepository(memoryStorage())`, `createPreviewStore({
clock, randomToken: sequentialToken() })`, fixed `Clock`), drive tools only
through `execute()`, and parse `JSON.parse(result.content[0].text)`. Covers:
AC1 (both names present), AC2/AC7 (end-to-end honesty: preview then apply,
diff/affected_ids/diff_summary match), AC3 (apply's optional fields), AC4
(two registries with different kinds produce different descriptions/schemas,
plus the `?raw` source-scan asserting no operation-kind literal), AC5
(unknown kind → successful preview with `applicable:false`, identity-keyed
spy handler never invoked), AC6 (one test per `SafetyErrorReason`, seven
total), AC8 (a kind registered inside the test only, named nowhere in
`safetyTools.ts`, driven through both tools), AC9 (schema shape assertion),
AC10 (`buildTools` from `webmcp/tools.ts` unchanged + full suite green).

Mutation-check: after tests are green, temporarily break the implementation
in 5+ ways (drop the registry-kinds call and hardcode a schema, skip the
`SafetyError` branch in `toErrorResult`, forward an unknown kind's input to
`deps.registry.get` without going through `evaluateBatch`, swap
`toWirePreviewResult`/`toWireEnvelope` for a hand-rolled object, remove the
`workspace_id`/`expected_revision`/`idempotency_key` passthrough) and confirm
each break fails the relevant test, then restore.
