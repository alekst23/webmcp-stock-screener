# T-1013-3: Structured workspace diff and diff summary

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Done
**Depends on**: T-1013-1
**Blocks**: T-1013-5

## Description

Turn a before-state and an after-state into the diff the safety layer
reports: a machine-checkable list of typed entity changes keyed by stable
ID, and the short human-readable `diff_summary` the common mutation
contract requires. Both preview and apply report this same diff, so it is
the artifact the honesty guarantee is checked against.

## User Story

As a researcher reading what an agent is about to change,
I want a precise list of which entities are added, removed, or updated and
a one-line summary of the batch,
so that I can approve or reject the change without reading a state dump.

## Acceptance Criteria

1. Given two workspace states, the diff reports each changed entity as
   added, removed, or updated, identified by its stable ID.
2. An updated entity's diff names the changed fields with their before and
   after values, and omits fields that did not change.
3. Two identical states produce an empty diff, not a diff of unchanged
   entities.
4. Diff output is deterministic — the same pair of states always produces
   the same ordering, so results are comparable across calls.
5. The affected-ID list is the deduplicated set of stable IDs appearing in
   the diff, in first-appearance order.
6. A human-readable summary is derived from the structured diff (plus any
   summary fragments the operations contributed), and never describes a
   change the structured diff does not contain.
7. An empty diff produces a summary that says so rather than an empty
   string.
8. A summary of a large batch stays short enough to read at a glance,
   degrading to a count of remaining changes rather than growing without
   bound.
9. Diffing is a pure function of its inputs — no I/O, no clock, no state.
10. The diff traverses workspace entities generically rather than
    enumerating the entity kinds known today, so entity kinds added by
    later epics appear in diffs without changing this code.

## Design References

- `docs/design/safety-preview-apply/technical.md` — "Diff shape"
- `docs/reference/tool-spec.md` — the envelope's `diff_summary` example
  (`"Added RSI study and RSI 40–70 filter"`) and `affected_ids`
- `docs/design/safety-preview-apply/spec.md` — the honesty guarantee this
  output is measured against

## Technical Considerations

Determinism matters more than it looks: the honesty tests compare a
preview's diff to an apply's diff by equality, so any ordering that
depends on object-key iteration or insertion timing will produce
flaky-looking failures that are actually real ambiguity.

## Out of Scope

Computing the after-state (T-1013-2) and rendering the diff in any UI.

## Implementation Plan

New file `src/lib/workbench/domain/workspaceDiff.ts` (plus its test), building
on the contracts already landed in `domain/preview.ts` (`DiffEntry`,
`FieldChange`, `WorkspaceDiff`, `DiffChangeType`, `collectAffectedIds`). No
existing source file changes.

### Exports

```ts
export function diffWorkspaces(before: WorkspaceDocument, after: WorkspaceDocument): WorkspaceDiff;
export function summarizeDiff(diff: WorkspaceDiff, fragments?: readonly string[]): string;
```

### Generic traversal (AC1, AC10)

`diffWorkspaces` never names `panels` / `layout` / `links`. It walks the union
of the two documents' own keys and classifies each by the *shape* of its
value:

- **Entity collection** — an array whose every element is a plain object. Each
  element's identity is its string `id`; failing that, the value of its single
  string-valued property whose name ends in `Id` (this is what makes `layout`,
  keyed by `panelId`, diffable without naming it). `entityType` is the
  property key itself.
  - in `after` only -> `added`, `fields: []`
  - in `before` only -> `removed`, `fields: []`
  - in both but not deeply equal -> `updated` with only the changed fields
    (AC2)
  - element with no derivable identity -> compared positionally and reported
    as a `<key>[<index>]` field change on the `workspace` entry, so it is
    never silently dropped
- **Everything else** (scalars, nulls, arrays of scalars, plain objects) ->
  a field change gathered onto a single
  `{ change: 'updated', entityType: 'workspace', id: after.id }` entry.
- **`extensions`** — recursed with the same two rules, one level down. An
  extension key holding an identified-object array becomes a collection with
  `entityType: 'extensions.<key>'`; anything else becomes an
  `extensions.<key>` field change on the workspace entry. Sibling epics'
  entity kinds therefore appear in diffs with no edit to this file.
- **`revision` and `updatedAt` are excluded.** The revision service stamps
  them at commit time; they are bookkeeping, not effects of the batch, and
  including them would make every diff report a spurious change and break the
  preview/apply equality the honesty tests rely on.

Change detection uses a small local `deepEqual` (no new dependency).

### Ordering rule (AC4)

Nothing depends on object-key iteration order or insertion timing:

1. The `workspace` entry, if any, first.
2. Then collections sorted by `entityType` string (extension collections sort
   under their `extensions.` prefix, so top-level and extension collections
   interleave by one total, stable rule).
3. Within a collection: `added`/`updated` in `after`-array order, then
   `removed` in `before`-array order.
4. Within an entry: `fields` sorted by field name.

`collectAffectedIds` (imported from `./preview`, not reimplemented) then
yields the deduped first-appearance ID list for free (AC5).

### Summary (AC6, AC7, AC8)

`summarizeDiff` is derived from the structured diff, so it cannot describe a
change the diff does not contain:

- Empty diff -> `'No changes.'`, never an empty string (AC7).
- Non-empty diff with `fragments` -> the fragments supply the phrasing (each
  counting as one change); without them, clauses are derived by grouping diff
  entries on `(change, entityType)` in first-appearance order, e.g.
  `Added 2 panels`. Fragments are ignored for an empty diff, which is what
  keeps the summary from outrunning the diff (AC6).
- At most 3 clauses render; the rest degrade to `and N more changes`, where N
  counts the diff entries the unrendered clauses stand for, so the sentence is
  length-bounded for any batch size (AC8).
- One short present-tense sentence matching the house example
  `"Added RSI study and RSI 40–70 filter"`.

### Purity (AC9)

Both functions read their arguments and return new values: no I/O, no clock,
no module-level state, no mutation of `before` or `after`.

### Tests

`workspaceDiff.test.ts` covers every AC, and specifically: identical states ->
empty diff and a "no changes" summary; updated entity lists only changed
fields; two structurally identical `after` documents built with different
property-insertion and array-construction orders produce deeply equal diffs,
and repeated calls are stable; `collectAffectedIds` over a real diff;
a novel entity collection under `extensions` (a kind the source never names)
appearing as added/removed/updated; `panelId`-identified layout entries;
a 20-entity batch summarized under a stated character bound and ending in a
remaining-count clause; frozen inputs proving non-mutation.
