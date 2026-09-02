# T-1010-1: Results table configuration domain model and validation

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Done
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
- `docs/reference/tool-spec.md` — the `configure_panel_view` row (this
  epic's table-renderer contract is what that tool validates against for
  a `table`-rendered panel) and the stable-ID rule in the common
  contract.
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

## Solution Approach

### Location

New module `src/lib/results/domain/tableConfig.ts` (+ co-located
`tableConfig.test.ts`), starting a new `src/lib/results/` area for this
epic, mirroring `src/lib/panels/domain/` and `src/lib/workbench/domain/`.
Pure domain: no I/O, no import from `src/lib/webmcp/`. Imports only
`ResourceId`/`IdSequencer`/`parseId` from `../../workbench/domain/ids`
and the `CatalogValueType`/`CatalogRegistry` *types* from
`../../catalog/types` and `../../catalog/registry` (never
`builtinCatalogRegistry` itself — the caller always injects a registry).

### Column identity model

A column's *identity* (what data backs it) is separated from a *display
column* (that it is shown, with a label/unit/type), because a sort or
grouping key is allowed to name an identity that isn't currently
displayed (AC6), while a formatting rule must name an actually-displayed
column (AC7). Concretely:

```ts
type ColumnIdentity =
  | { source: 'catalog_field'; fieldId: string }
  | { source: 'computed_column'; computedColumnId: ResourceId }
  | { source: 'result_id' } // synthetic, always resolvable; used as the default tie-break

interface ComputedColumn {
  id: ResourceId;       // kind 'column'
  label: string;
  unit?: string;
  valueType: CatalogValueType;
  expression: string;   // formula source, e.g. "volume / sma(volume, 20)"
}

interface DisplayColumn {
  id: ResourceId;        // kind 'column'; what formatting rules reference
  identity: ColumnIdentity;
  label: string;
  unit?: string;
  valueType: CatalogValueType;
}
```

`ResourceKind` gains two single-word, additive entries in
`src/lib/workbench/domain/ids.ts`: `'column'` (both `DisplayColumn.id`
and `ComputedColumn.id` — both are "a column" resource) and `'rule'`
(`FormattingRule.id`). This is a narrow, explicitly-sanctioned addition
(ticket workflow step 3) — genuinely necessary because AC1 requires every
column and rule to carry its own stable ID (never a positional index),
and no existing kind means "column" or "formatting rule" without
colliding with an unrelated concept (`filter` means screener filter-tree
nodes).

### Expression parsing for computed columns (AC3)

No expression parser exists yet in the codebase (checked
`src/lib/webmcp/tools.ts`'s `ExpressionError` — it carries a function
catalog on rejection, but the actual parser lives in the legacy engine
this epic must not touch). This ticket adds a small, self-contained
recursive-descent parser local to `tableConfig.ts`:

- Tokens: numbers, identifiers (`[a-zA-Z_][a-zA-Z0-9_.]*`, so dotted
  catalog field ids like `field.fundamentals.pe_ratio` tokenize as one
  identifier), `+ - * / % ^ ( ) ,`.
- Grammar: `expr := term (('+'|'-') term)*`, `term := power (('*'|'/'|'%') power)*`,
  `power := unary ('^' unary)?`, `unary := '-' unary | primary`,
  `primary := number | call | field | '(' expr ')'`, `call := ident '(' (expr (',' expr)*)? ')'`.
- Parse errors are returned as data (`{ ok: false; error: string }`),
  never thrown — matching `filterTree.ts`'s and `links.ts`'s
  result-not-exception convention.
- A fixed, domain-owned `PERMITTED_FUNCTIONS` list (`abs, min, max,
  round, sqrt, log, ln, avg, sum`) — functions are a math vocabulary, not
  catalog-dependent, so they aren't part of the injected catalog.
- After a successful parse, the AST is walked to collect every `field`
  and `call` reference. A field reference is permitted only if the
  injected `CatalogRegistry.getCatalogItem(id)` resolves to a `kind:
  'field'` item with `valueType: 'number'` (arithmetic requires numeric
  operands — a documented assumption, noted below). A call reference is
  permitted only if its name is in `PERMITTED_FUNCTIONS`. Either kind of
  violation, or a parse failure, rejects the computed column and the
  rejection always carries the parse error (or a synthesized "field/
  function not permitted" message), the sorted list of permitted field
  ids the registry currently exposes as numeric fields, and
  `PERMITTED_FUNCTIONS` — so a one-turn self-correction (as the ticket's
  Design References call out from `tools.ts`'s `ExpressionError`
  pattern) has everything it needs.
- A computed column's expression may reference catalog fields only, not
  other computed columns (no cross-computed-column references) — avoids
  needing cycle detection in a ticket that explicitly excludes
  evaluation (T-1010-4's job).

### Validation result shape (AC9)

Following `panels/domain/links.ts`'s `LinkResult` discriminated-union
convention (preferred here over `screener/validation.ts`'s flat
severity-tagged list, since AC4/AC5's rejections must prevent *any*
partial application — a top-level `ok` discriminant makes "did this
apply" unambiguous at the type level):

```ts
type ResultsTableValidationResult =
  | { ok: true; config: ResultsTableConfig; warnings: ResultsTableWarning[] }
  | { ok: false; rejections: ResultsTableRejection[] }

interface ResultsTableRejection { code: string; message: string; elementId?: string }
interface ResultsTableWarning { code: string; message: string; elementId?: string }
```

`elementId` names "the specific element at fault" (AC9) — a field id, a
column id, a rule id, etc. — always mentioned in `message` too (prose
must stand alone; `elementId` is the machine-readable echo). On success,
`config` is the *normalized* configuration (page size and sort tie-break
resolved to their defaults) — this is how AC5's "resolves to the
documented default" is expressed without a separate resolver the caller
must remember to call.

### Validation entry point

```ts
function validateResultsTableConfig(
  config: ResultsTableConfig,
  catalog: CatalogRegistry
): ResultsTableValidationResult
```

Checks, in order (each collects into `rejections` or `warnings`; a
rejection anywhere stops before building a normalized config, matching
AC4 "no partially applied result"):

1. **Page size** (AC5): `null`/`undefined` resolves to `DEFAULT_PAGE_SIZE
   = 25`; above `MAX_PAGE_SIZE = 200` is a rejection naming 200; a
   non-positive or non-integer page size is also rejected (basic
   sanity, not explicitly in the ACs but required for "a page size" to
   be meaningful).
2. **Computed columns**: parse + permitted-field/function checks above;
   duplicate `id`s among `computedColumns` rejected.
3. **Display columns**: duplicate `id`s rejected; each `identity`
   resolved — `catalog_field` must exist in the catalog as a `field`
   item (AC4, naming the offending field id); `computed_column` must
   match a `computedColumns[].id` in this same config.
4. **Sort** (optional): key identity must resolve (unknown catalog field
   or computed column id is a rejection, same as AC4); if it resolves
   but isn't backed by any entry in `columns`, a warning is added (AC6)
   naming the key. Tie-break defaults to `{ source: 'result_id' }` when
   omitted (always resolvable, giving the "deterministic tie-break" AC1
   requires); if the caller supplies one explicitly it is resolved the
   same way as the primary key but does not itself trigger a visibility
   warning (AC6's wording is "a sort or grouping key", i.e. the primary
   key).
5. **Grouping** (optional): same resolution and warning rule as sort's
   primary key.
6. **Formatting rules**: duplicate `id`s rejected; each
   `predicate.columnId` must match a `columns[].id` in this same
   config — an identity that exists but isn't displayed is *not*
   sufficient here (AC7 is stricter than AC6 on purpose: a formatting
   rule paints a cell that must be on screen), rejected naming both the
   rule id and the column id.
7. **Chart panel** (optional): if `chartPanelId` is set, it must parse
   (`parseId`) as a `panel`-kind `ResourceId`. Actual existence in a
   workspace is out of scope here (no panel registry is injected) —
   left to T-1010-6.

### Explicitly out of scope / deferred to later tickets

- No evaluation of expressions against real data (T-1010-4).
- No check that a referenced `chartPanelId` actually exists or is a
  chart-kind panel (T-1010-6, which has the panel registry).
- No wire (snake_case) serialization helper for the full config in this
  ticket — `mutation.ts`'s `toWireEnvelope` pattern is the *convention*
  to follow, but the wire shape for `configure_panel_view`'s table
  contract belongs to T-1010-6, which owns that tool's request/response
  schema; inventing it here risks needing to change it there. `ids.ts`'s
  `mintId`/`IdSequencer` are reused as-is for `column`/`rule` ids (no
  new minting helpers needed beyond calling `ids.next('column')` /
  `ids.next('rule')` directly — mirrors how `filterTree.ts` calls
  `ids.next('filter')` inline rather than wrapping it).

### Test plan

Co-located `tableConfig.test.ts`, one `describe` per concern: expression
parser (valid arithmetic, function calls, dotted field ids, syntax
errors, unknown field, unknown function), page size (default, at max,
over max, non-positive), display columns (unknown catalog field,
duplicate ids, computed-column-backed column resolving), sort/grouping
(unknown key rejected, hidden key warns, tie-break default), formatting
rules (unknown column rejected naming rule+column, duplicate rule ids),
chart panel id shape, and an end-to-end happy-path config producing
`ok: true` with an empty warnings list. Each new behavior's test is
mutation-checked (temporarily reverted to confirm it fails) before the
ticket is marked Done.
