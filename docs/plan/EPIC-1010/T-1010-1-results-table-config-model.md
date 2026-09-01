# T-1010-1: Results table configuration domain model and validation

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Open
**Depends on**: —
**Blocks**: T-1010-4, T-1010-6

## Description

Define the typed model for how a results table presents a screener run:
displayed columns, computed columns, sort, grouping, conditional
formatting, page size, and the chart panel the table is bound to — plus
the validation that decides whether a proposed configuration is
acceptable. This is pure domain logic with no I/O; the use cases in Wave 2
apply it.

## User Story

As the agent configuring how results are displayed,
I want a configuration that is validated as a whole before anything is
applied,
so that a bad column or a malformed formula becomes a single corrective
message rather than a half-applied table.

## Acceptance Criteria

1. A results-table configuration expresses: an ordered list of displayed
   columns, computed columns, a sort specification (key plus direction,
   with a deterministic tie-break), a grouping specification, an ordered
   list of conditional formatting rules, a page size, and an optional
   bound chart panel — each referenced by stable ID, never by ticker or
   positional label.
2. Each column carries the metadata needed to render and interpret it:
   its catalog field or computed-column identity, a display label, a unit,
   and a value type.
3. A computed column is defined by an expression over permitted fields
   and functions; an expression that fails to parse, or that references a
   field outside the permitted set, is rejected with the parse error and
   the list of permitted fields and functions.
4. Validation rejects a configuration that references an unknown catalog
   field, naming the offending field, and returns no partially applied
   result.
5. Validation rejects a page size above the hard maximum, naming the
   maximum, rather than silently clamping it; a configuration with no page
   size resolves to the documented default.
6. Validation accepts a sort or grouping key that is not among the
   displayed columns but returns a warning stating the key is not
   visible.
7. Validation rejects a conditional formatting rule whose predicate
   references a column that is not part of the configuration, naming the
   rule and the column.
8. Validation of a configuration is a pure function of the configuration
   and the available catalog — it performs no I/O and does not depend on
   any run.
9. Validation results distinguish rejections (which prevent application)
   from warnings (which do not), and every message names the specific
   element at fault.

## Design References

- `docs/design/results-and-explain/spec.md` — "Configure the results
  table" scenarios; Open Questions 3 and 4 for the evaluation-scope and
  page-size assumptions this ticket encodes.
- `docs/reference/tool-spec.md` — the `configure_results_table` row and the
  stable-ID rule in the common contract.
- `src/lib/webmcp/tools.ts` — the existing expression-error handling
  pattern that returns the function catalog to the agent for one-turn
  self-correction; the computed-column rejection follows the same idea.

## Technical Considerations

- The permitted field set comes from EPIC-1008's catalog. Take it as an
  injected input to validation; do not reach for a catalog client from
  the domain layer.
- Keep the model free of any dependency on a run — a configuration is
  valid or invalid independently of whether results exist.

## Out of Scope

- Applying a configuration to a workspace, revisions, and the mutation
  envelope (T-1010-6).
- Projecting actual result rows through the configuration (T-1010-4).
- Rendering (T-1010-7).
