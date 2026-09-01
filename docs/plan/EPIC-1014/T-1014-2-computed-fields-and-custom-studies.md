# T-1014-2: Computed fields and custom studies

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Open
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

## Out of Scope

- The typed expression model and validator themselves (T-1014-1).
- Editing or deleting a field or study after creation beyond what undo
  provides.
- Any authoring UI. The researcher sees the results through existing
  panels.
- Sharing or exporting field and study definitions between workspaces.
