# T-0020-12: Disambiguate screener-revision vs. workspace-revision in the tool surface

**Epic:** EPIC-0020
**Status:** Done

## Goal

`run_screener` and `define_screener` already correctly model two distinct revision
concepts in code — `expected_revision` (the workspace's own revision, checked via
`RevisionConflictError`) and `screener_revision` (the screener definition's own
revision, resolved via `resolveScreenerRevision()` in `runScreener.ts:118-138`,
rejected via a distinct `OperationValidationError`). An agent conflated the two
live (2026-09-04): it passed the workspace revision where `screener_revision` was
expected, the call was rejected, and it took a retry to recover. The two concepts
are correctly separated in the code; they were not correctly separated in what the
tool surface *tells* an agent about them.

This does **not** add a new `get_screener_definition` (or similar) read tool —
`docs/design/screener-core/spec.md` already made an explicit "no separate read
tool" decision for MVP and this ticket does not reverse it. It only sharpens
existing parameter descriptions and error text.

## Acceptance criteria

- `run_screener`'s and `define_screener`'s tool schema descriptions for
  `expected_revision` and `screener_revision` (where each is accepted) name which
  concept each refers to distinctly enough that reading them alone prevents
  conflating the two (e.g. explicitly stating "this is the workspace's own
  revision, not the screener definition's" and vice versa).
- The `OperationValidationError` raised by `resolveScreenerRevision()` when an
  unretained/wrong `screener_revision` is supplied states plainly that a screener
  revision (not a workspace revision) was expected, and what was received.
- A test snapshots or asserts on the relevant tool description text and the error
  message text, so a future edit that erodes the distinction is caught.

## Solution Approach

Implements the "Disambiguated revision parameters" scenario from
`docs/design/workbench-composition-root/spec.md`. Text-only changes — no new
control flow, no new contracts.

- Confirmed root cause: `src/lib/webmcp/screener/runScreener.ts`'s `INPUT_SCHEMA`
  (~line 67-81) gives `screener_revision` a real description but gives
  `expected_revision` none at all (`{ type: 'number' }`) — an agent reading the
  schema has nothing distinguishing the two. Add a description to
  `expected_revision` stating it is the *workspace's* own revision (optimistic
  concurrency), and extend `screener_revision`'s existing description to
  explicitly contrast it against `expected_revision` by name (each description
  should name the other parameter and say what it is not).
- Do the same for `define_screener`'s `expected_revision` field
  (`src/lib/webmcp/screener/defineScreener.ts:74` and its schema) if it has the
  same gap — check whether it already documents itself sufficiently, and only
  change what's actually unclear.
- Error text: `resolveScreenerRevision()`'s `OperationValidationError` in
  `runScreener.ts` (~line 111-136) already says "Screener revision N for
  screener "X" is no longer retained" — this already names it as a screener
  revision, so likely just needs a small addition naming what *was* received
  vs. expected if that's not already implicit in the message, per the ticket's
  AC. Read the current message carefully before deciding whether it needs
  changing at all — do not rewrite a message that already meets the AC.
- Do not add a `get_screener_definition` tool or any other new read tool —
  `docs/design/screener-core/spec.md`'s existing "no separate read tool"
  decision stays in force.

### Contracts to define

None — description strings and an error message only.

## Implementation Notes

- `run_screener`'s `INPUT_SCHEMA` (`src/lib/webmcp/screener/runScreener.ts:72-86`):
  `expected_revision` gained a description naming it as the workspace's own
  revision and naming `screener_revision` by name as the parameter it is not.
  `screener_revision`'s existing description was extended to name
  `expected_revision` by name in the same way.
- `resolveScreenerRevision()`'s `OperationValidationError`
  (`src/lib/webmcp/screener/runScreener.ts:143-148`) now leads with
  "screener_revision must be the screener definition's own revision, not the
  workspace's expected_revision" before stating the unretained revision number
  and screener id that were actually received.
- `define_screener`'s `expected_revision` field
  (`src/lib/webmcp/screener/defineScreenerSchema.ts:98-104`) had the same gap
  (`{ type: 'number' }`, no description) and got the same workspace-revision
  description; it also notes that `define_screener` never accepts
  `screener_revision` as input (only returns it), so the description points to
  where the screener's own revision does appear in this tool's contract.
- No change was needed to `define_screener.ts` itself (line ~74) beyond the
  schema import it already uses from `defineScreenerSchema.ts` — the schema
  file is the single source of the wire-facing description text.
- Added `test_inputSchema_screenerRevisionDescription_namesItAsTheScreenerDefinitionsRevision`
  and error-message assertions to `runScreener.test.ts`, and
  `test_inputSchema_expectedRevisionDescription_namesItAsTheWorkspaceRevision`
  to `defineScreener.test.ts`, per the AC's "test snapshots or asserts on the
  relevant tool description text and the error message text" requirement —
  the one pre-written stub only covered `run_screener`'s `expected_revision`.
- No new read tool was added; `docs/design/screener-core/spec.md`'s "no
  separate read tool" decision is unchanged.
- `npx vitest run` on both test files: 2 pre-existing failures remain
  (`test_runScreener_noResultsTablePanel_createsOneAndBindsIt` and
  `test_runScreener_rerunAfterAutoCreate_recyclesSamePanelRatherThanCreatingAnother`)
  — these are failing stubs for a different ticket (T-0020-10, create-if-absent
  results panel) that were already failing before this ticket's changes and are
  out of this ticket's scope. All T-0020-12 tests pass.
- `npm run typecheck`: 0 errors, 0 warnings.
