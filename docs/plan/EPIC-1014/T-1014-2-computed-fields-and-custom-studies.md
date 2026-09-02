# T-1014-2: Computed fields and custom studies

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Done
**Depends on**: T-1014-1
**Blocks**: T-1014-11
**Issue**: —

## Description

Deliver `create_computed_field` and `create_custom_study` — the two
authoring tools that let an agent extend the screener's vocabulary
without extending its attack surface. A computed field becomes a usable
results column, ranking input, and filter operand. A custom study becomes
addable to charts and usable in study-output filter conditions, and
describes itself in the catalog exactly the way a built-in study does.

Both are built on T-1014-1's typed expression model, so validation,
error reporting, and the no-code-execution guarantee are inherited rather
than re-implemented.

## User Story

As a researcher whose idea does not fit the built-in fields,
I want my agent to define the derived value or study I actually mean and
then use it everywhere a built-in one works,
so that the screener adapts to my research instead of my research bending
to the screener's field list.

## Acceptance Criteria

1. `create_computed_field` accepts a name and a typed expression and
   creates a computed field with a stable ID, reporting its result type
   and unit.
2. A created computed field can be used as a results-table column, as a
   ranking input, and as an operand in a filter condition, addressed by
   its stable ID.
3. `create_custom_study` accepts a name, a typed expression over
   permitted series and functions, and declared parameters with defaults
   and valid ranges, and creates a study with a stable ID.
4. A created custom study appears in the catalog and describes its
   parameters, valid ranges, defaults, outputs, and units the same way a
   built-in study does; it can be added to a chart and used in a
   study-output filter condition.
5. Either tool rejects an expression that references a field, function,
   series, or parameter value outside the permitted catalog. The error
   names the offending identifier and offers permitted alternatives.
6. Either tool rejects a body supplied as SQL, JavaScript, or any other
   free-form executable text. No such text is ever evaluated.
7. Either tool rejects an expression whose types or units are
   incompatible, or whose evaluation cost exceeds the configured bounds,
   with an explanation of which limit was hit.
8. When a computed field's value cannot be determined for a row — missing
   data, division by zero — the row shows an explicit "not available"
   rather than failing the run, and the run's warnings note that it
   happened and how many rows were affected.
9. Both tools accept `expected_revision` and `idempotency_key` and return
   the common mutation envelope. A stale `expected_revision` is rejected
   without creating anything; a repeated `idempotency_key` returns the
   original result without creating a duplicate.
10. Undoing a creation with the returned undo token removes the field or
    study and restores any column, ranking, chart, or filter that
    referenced it to its prior state.
11. Creating a field or study whose name collides with an existing one is
    handled explicitly — either rejected naming the collision, or
    accepted with distinct stable IDs and a warning — never silently
    overwriting the existing one.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Author a computed
  field" and "Author a custom study" scenario tables.
- `docs/reference/tool-spec.md` — `create_computed_field` and
  `create_custom_study` in the follow-up list; the "typed expression
  model, never arbitrary JavaScript" requirement; the common mutation
  contract.
- `docs/plan/EPIC-1014/T-1014-1-typed-expression-model.md` — the model
  and validator this ticket builds on.
- `docs/plan/EPIC-1006/_epic.md` — the mutation envelope,
  `expected_revision`, `idempotency_key`, and undo tokens.
- `docs/plan/EPIC-1008/_epic.md` — the catalog registry these
  registrations must appear in and be describable through.
- `docs/plan/EPIC-1009/_epic.md` — the filter-tree condition model that
  must accept a computed field as an operand and a custom study as a
  study-output source.

## Technical Considerations

- A computed field and a custom study are different resources with
  different lifetimes and different consumers; keep them distinct even
  though they share the expression model.
- Registration into the catalog is EPIC-1008's contract. Register through
  it rather than maintaining a second, parallel list.
- Undo has to reach references, not just the definition — a field removed
  while a results column still points at it would leave the workspace
  inconsistent.

## Solution Approach

`--skip-design-gate` authorized per the dispatch instructions; this section is
written before any implementation code, per that exchange.

### Layout

New files only, alongside T-1014-1's `domain/`:

```
src/lib/workbench/followup/domain/
  followupIds.ts              -- stable catalog-shaped ID minting + seeding
  computedField.ts             -- ComputedFieldRecord: read/write/normalize/toWire/toFieldItem
  customStudy.ts                -- CustomStudyRecord: read/write/normalize/toWire/toStudyItem
  customStudyParameters.ts      -- declared-parameter model/resolution/override substitution
                                    (split out of customStudy.ts, size guidance)
  workspaceCatalog.ts           -- composeWorkspaceCatalogRegistry(doc, base?): CatalogRegistry
  computedFieldEvaluation.ts    -- AC8 batch row evaluator ("not available" + warning)
src/lib/workbench/followup/application/
  createComputedField.ts      -- OperationDefinition + prepare/apply (mirrors alerts pattern)
  createCustomStudy.ts
src/lib/workbench/followup/tools/
  createComputedField.ts      -- wire tool wrapper (mirrors alerts/tools/createAlertDraft.ts)
  createCustomStudy.ts
  index.ts                    -- buildFollowupTools(deps)
  registerFollowupTools.ts    -- composition root, gated off (FOLLOWUP_TOOLS_ENABLED = false),
                                  matching registerScreenerTools.ts/registerAlertTools.ts precedent
```

Every file above is `*.test.ts`-paired.

### Storage: WorkspaceDocument extensions, not a second list

Computed fields and custom studies are stored under
`doc.extensions['followup.computed_fields']` and
`doc.extensions['followup.custom_studies']` respectively — the same
extension-key convention `alerts/domain/alert.ts` and
`watchlist/domain/watchlist.ts` already use. Two separate maps (different
lifetimes/consumers per the ticket's own Technical Considerations), each
keyed by the record's own stable catalog-shaped ID.

### Stable IDs: catalog-shaped, not workbench-shaped

A computed field/custom study's ID is consumed everywhere a built-in
`field.*`/`study.*` catalog ID is consumed today (`FieldRefNode.fieldId`,
`Condition.fieldId`/`studyId`, `RankingField.fieldId`,
`ColumnIdentity.fieldId`) — all of that code does a bare
`registry.getCatalogItem(id)`/`registry.resolveStudy(id)` map lookup with no
grammar check, so the ID must look like the rest of the catalog to slot in
cleanly: `field.custom.<n>` / `study.custom.<n>`, built via
`surface/ids.ts`'s already-published `makeCatalogItemId`.

`<n>` must never repeat across a session even after an undo removes a
record (a stale reference or a redo could otherwise resolve to a different
definition under the same ID) — so `<n>` is minted from the shared, monotonic
`IdSequencer`, not derived by rescanning current document content. This
needs two new `ResourceKind` entries, `'computed_field'` and
`'custom_study'`, added to `src/lib/workbench/domain/ids.ts` — a small,
purely additive change to a closed union whose own header comment says it
is "every resource in the new workbench surface" and which Wave 1 already
extended twice for exactly this reason (`'alert'`, `'watchlist'`). This is
the one existing file this ticket touches; everything else is new files.
`followupIds.ts` also provides `computedFieldIdSeed`/`customStudyIdSeed`
(scanning stored catalog-shaped IDs for their trailing `<n>`) so a reloaded
workspace's sequencer resumes rather than restarts, mirroring
`chart`'s/`watchlist`'s/`filterDraft`'s seeding precedent (not
`alerts`', which does not seed today).

### Catalog registration: compose the published port, don't touch EPIC-1008

`catalog/registry.ts`'s `CatalogRegistry` is exported as an **interface**,
and every consumer already takes one as an injected parameter defaulting to
`builtinCatalogRegistry` (`conditionValidation.ts`, `tableConfig.ts`,
`engine.ts`, `chartStudies.ts`, `deriveFilters.ts`, ...). Nothing in
EPIC-1008/1009/1010 needs to change for a computed field or custom study to
work as a column/ranking-input/filter-operand/study-output/chart-study: it
only needs to be resolvable through *some* `CatalogRegistry` implementation
those call sites are handed.

`workspaceCatalog.ts` implements that interface by composing a base
registry (default `builtinCatalogRegistry`) with the workspace's own
computed fields (projected to `FieldItem`) and custom studies (projected to
`StudyItem`) via `computedField.ts#toFieldItem` /
`customStudy.ts#toStudyItem`. `getCatalogItem`/`resolveStudy` check the
overlay first; `listCatalogItems`/`searchCatalogItems`/`suggestCatalogIds`
merge both sources. This is "register through EPIC-1008's contract" in the
literal sense available today: implement its published port, not a second
parallel id→item map.

**What this ticket deliberately does not do**, and flags rather than
self-approves: there is no live composition root today that threads a
per-workspace registry into the screener/results/chart tool surfaces — all
of those are already gated off (`SCREENER_TOOLS_ENABLED = false` in
`registerScreenerTools.ts`, and no code found wiring
EPIC-1008/1009/1010/1014 into one running app). Wiring
`composeWorkspaceCatalogRegistry`'s output into those composition roots
would mean editing already-merged EPIC-1009/1010 registration files, which
is out of this ticket's authority per the dispatch instructions. Tests
instead prove the mechanism directly: call EPIC-1009's exported
`validateCondition`/EPIC-1010's exported `validateResultsTableConfig` with
the composed registry and assert a created computed field/custom study
validates as a field/study operand exactly like a built-in one — the same
proof those modules' own tests use, just pointed at a different registry
instance, with no source edits to either module.

### create_computed_field (AC1, AC2, AC5-AC11)

`application/createComputedField.ts`, `OperationDefinition` pattern
(mirrors `alerts/application/createAlertDraft.ts`):

1. `prepareCreateComputedField(rawInput, doc, { registry })`: validates
   `name` (non-empty), builds the workspace-composed registry from `doc`,
   runs T-1014-1's `validateExpression(rawInput.expression, registry)`
   unchanged (AC5, AC6, AC7 inherited verbatim — a string/array/anything
   that isn't a plain `{kind: ...}` object fails `unknown_node_kind` before
   any evaluation is possible), rejects a name collision (case-insensitive,
   AC11 — "handled explicitly" via a named rejection rather than silent
   overwrite or silently-created duplicate).
2. `applyCreateComputedField`: mints the field's stable ID, writes the
   record into `extensions['followup.computed_fields']`, returns a
   `MutationDraft` whose `inverse.document` is the pre-mutation `doc` — a
   create only ever adds one map entry, so that's its own exact inverse
   (same reasoning `createAlertDraft.ts` already documents).
3. `tools/createComputedField.ts`: wire parsing, `expected_revision`/
   `idempotency_key` passthrough into `applyOperations`/`revisionService`
   (inherited verbatim — AC9's stale-revision-rejects/idempotency-replay
   behavior is `RevisionService.commit`'s existing, already-tested
   contract, not reimplemented here), envelope + `computed_field_id` +
   wire record in the result.

### create_custom_study (AC3, AC4, AC5-AC11)

Same three-layer shape. The added complexity is AC3's "declared parameters
with defaults and valid ranges": T-1014-1's expression tree has no
parameter-reference node (only `literal`/`field_ref`/`function_call`/
`arithmetic`/`comparison` — extending that model is explicitly out of
scope), so a declared parameter is modeled as a *binding* onto an already-
validated tree rather than a new node kind:

```ts
interface CustomStudyParameterDeclaration {
  name: string;       // the study's own parameter name
  nodePath: string;    // e.g. "root.left" -- expressionValidator.ts's own path grammar
  argName: string;      // must name a declared arg of the function_call at nodePath
  range?: NumericRange;  // must be a subset of the underlying arg's own declared range
}
```

`customStudy.ts` resolves `nodePath` by walking the validated tree's
`arithmetic`/`comparison` `.left`/`.right` edges (the only edges the model
has) down to a `function_call` node, reads that call's already-normalized
`args[argName]` as the parameter's default (AC3's "defaults" — literally
whatever literal the author already wrote there), and reads the
function's own declared `CatalogParameter` (via `registry.getCatalogItem
(functionId)`) for `valueType`/`unit`/`enumValues` and its own range, which
any author-declared `range` must fall inside. One binding per declared
parameter name (a "the same window used in two places, in lockstep" case is
a known, documented limitation, not silently wrong — a caller who needs
that binds the same value to each location as two separately-invalidated-
independent parameters today).

The resulting `CatalogParameter[]` is what makes the custom study "describe
its parameters, valid ranges, defaults ... the same way a built-in study
does" (AC4) — it becomes `StudyItem.parameters` via `toStudyItem`, read by
the exact same `validateCatalogParams`/`resolveStudyParams` code a built-in
study's parameters go through (EPIC-1009's `conditionValidation.catalog.ts`,
EPIC-1014 Wave 1's `chartStudies.ts`), proven by test rather than modified.
`toStudyItem` also exposes a single output named `'value'`
(`valueType`/`unit` from the body's own `ValidatedExpression.resultType`/
`resultUnit`) — a deliberate MVP scoping (no AC asks for a custom study
with more than one output) and `defaultIntervalId: 'interval.1d'` (the
project's one real data source, matching `catalog/items.ts`'s own
convention).

`customStudy.ts#resolveCustomStudyExpression(record, overrides)` rewrites
the validated tree with override values substituted at each binding's
location (validated against the same type/range check `create_custom_study`
used at authoring time) and returns a fresh `ExpressionNode` ready for
`expressionEvaluator.ts#evaluateExpression` — the concrete fulfillment of
`expressionEvaluator.ts`'s own comment that wiring a real context is this
ticket's concern. Not wired into a live study engine (none is enabled
today; same flagged gap as above), but directly tested.

### AC8: computed field row evaluation ("not available" + warning)

`computedFieldEvaluation.ts#evaluateComputedFieldForRows(record, rows,
ctx)`: for each row, calls T-1014-1's
`expressionEvaluator.ts#evaluateExpression` against an injected
`ExpressionEvaluationContext`; collects `{available:false}` outcomes,
returns `{ values: Map<instrumentId, ColumnValue>, warning:
ScreenerWarning | null }` where `warning` (using EPIC-1009's own
`ScreenerWarning` shape, `code: 'computed_field_unavailable'`) is present
only when at least one row was unavailable and names the field and the
affected count (AC8's "how many rows were affected"). This is the reusable
primitive; wiring it into `run_screener`'s actual per-instrument loop is
`screener/engine/engine.ts` (EPIC-1009, already merged, not part of this
epic's Wave 1) — flagged, not touched, per the dispatch instructions.
Division-by-zero and missing-field cases are already exercised by
`expressionEvaluator.test.ts`; this ticket's tests focus on the batching/
counting/warning-message layer on top.

### AC10: undo reaches references

No new mechanism is built for this — `changeHistory.ts`'s existing
whole-document-snapshot undo already satisfies it structurally: a create's
`inverse.document` is the exact pre-create `WorkspaceDocument`, so undoing
it reverts *everything* the document held, not just the map entry. The
existing "undo only targets the newest change; a superseded change directs
you to `restore_workspace_revision`" rule (already implemented,
`changeHistory.ts`) is what actually protects a reference: once a column/
ranking/filter/second-computed-field references field A, undoing A's
*specific* token is refused (`superseded`) rather than silently orphaning
the reference, and `restore_workspace_revision` reverts both the field and
whatever referenced it together. The test proves this using two of this
ticket's own resources (create field A, create field B whose expression
references A, assert `undoChange(A's token)` throws `superseded`, assert
`restoreRevision` to the revision right after A's creation removes both A
and B) — self-contained, no dependency on another epic's "column" or
"ranking" resource existing yet.

### Name collision (AC11)

Rejected explicitly (not accepted-with-a-warning): a case-insensitive name
match within the same resource kind (computed fields and custom studies are
separate namespaces) fails validation with an issue naming the colliding
id. Chosen over "accept with a warning" because two same-named computed
fields is much more likely an agent's own mistake (re-running a create it
already ran) than a deliberate choice, and rejecting is trivially safe to
retry past (rename, or reuse the existing field's id) where a silent second
ID is not.

### Testing

Domain: `followupIds`, `computedField`, `customStudy` (including the
parameter-binding resolver/validator and `resolveCustomStudyExpression`
override substitution), `workspaceCatalog`, `computedFieldEvaluation`.
Application + tools: creation success (id/type/unit reported, AC1/AC3),
unknown field/function named with suggestions (AC5), non-object/string body
rejected without evaluation (AC6, with an explicit assertion nothing was
evaluated), type/unit mismatch and cost-limit-exceeded rejected (AC7),
name collision rejected (AC11), stale `expected_revision` rejected without
creating anything (AC9), repeated `idempotency_key` returns the original
result without a duplicate (AC9), undo removes the record (AC10 base case)
and the superseded/restore case above (AC10 reference case). A cross-module
test feeds the composed registry into EPIC-1009's `validateCondition` and
EPIC-1010's `validateResultsTableConfig` to prove AC2/AC4's "usable as a
column/ranking input/filter operand/study-output source" claim against the
actual sibling-epic validators, unmodified.

Every new test gets a mutation check per the workflow: after writing it,
temporarily revert the corresponding piece of the fix/feature and confirm
the test fails, then restore it.

## Out of Scope

- The typed expression model and validator themselves (T-1014-1).
- Editing or deleting a field or study after creation beyond what undo
  provides.
- Any authoring UI. The researcher sees the results through existing
  panels.
- Sharing or exporting field and study definitions between workspaces.
