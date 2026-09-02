# T-1010-6: Table renderer contract (columns, sort, grouping, formatting, selection semantics)

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Done
**Depends on**: T-1010-1, EPIC-1007's T-1007-7 (source/renderer registry shape)
**Blocks**: T-1010-7

## Description

The two write behaviors of the Results area, now delivered as a
**contract this epic registers** rather than as standalone WebMCP tools:
applying a validated results-table configuration to a panel, and setting
a panel's selected results so linked chart and details panels follow.
Both are invoked through EPIC-1007's generic `configure_panel_view` and
`set_panel_selection` tools, which resolve to this ticket's validation and
application logic when the target panel's renderer is `table`; both still
go through EPIC-1006's workspace revision pipeline and return its
mutation envelope. This ticket owns the *behavior*; EPIC-1007 owns the
*tool call* that reaches it.

## User Story

As an agent shaping a research view,
I want to change how results are presented and pick out the rows worth
looking at,
so that the person I am working with sees the columns that matter and the
chart follows what I selected — with every change revisioned and
undoable, through the same generic panel tools I use for every other
panel.

## Acceptance Criteria

1. This ticket exposes a table-configuration apply function that
   EPIC-1007's `configure_panel_view` calls for a `table`-rendered panel;
   applying a results-table configuration updates the panel's
   configuration and returns the common mutation envelope: `change_id`,
   `new_revision`, `affected_ids`, `diff_summary`, `warnings`,
   `undo_token`.
2. `diff_summary` states in plain language what changed (for example,
   which columns were added or removed and how the sort changed), rather
   than restating the whole configuration.
3. A configuration that fails validation is rejected with the validation
   messages and applies nothing — the panel and the workspace revision are
   unchanged.
4. Validation warnings (such as a sort key that is not a visible column)
   are returned in the envelope's `warnings` while the mutation still
   applies.
5. This ticket exposes a selection apply function that EPIC-1007's
   `set_panel_selection` calls for a `table`-rendered panel; setting a
   selection replaces the panel's selected result IDs and returns the
   mutation envelope; selecting an empty set clears the selection.
6. A result ID that is not part of the run the panel is showing is
   rejected, naming the unknown ID, and the previous selection is
   unchanged.
7. When the panel is linked to a chart or details panel, the selection is
   propagated so those panels show the selected instrument; when several
   results are selected and the linked target can show only one, the
   primary (first) selection propagates and a warning states the rest did
   not.
8. Both mutations accept `expected_revision`; a caller whose
   `expected_revision` is behind the workspace's current revision is
   rejected as a revision conflict with nothing applied.
9. Both mutations accept `idempotency_key`; replaying a key returns the
   original result and leaves the workspace mutated exactly once, verified
   by a test that would fail on a duplicate write.
10. The `undo_token` returned by either mutation reverses it, restoring the
    previous configuration or selection.
11. A selection made by the person directly in the UI is readable by the
    agent, and an agent selection replaces it wholesale rather than
    merging into it silently.
12. Neither mutation executes a screener.

## Design References

- `docs/design/results-and-explain/spec.md` — "Configure the results
  table" and "Select results" scenarios.
- `docs/plan/EPIC-1010/T-1010-1-results-table-config-model.md` — the
  configuration model and its validation.
- `docs/reference/tool-spec.md` — the common mutation contract and its
  envelope shape.

## Technical Considerations

- The revision model, envelope, idempotency handling, and undo tokens are
  EPIC-1006's. Consume them; do not build a parallel mechanism. If
  EPIC-1006 has not landed when this starts, code against its contract
  and use a test double.
- Panel linking itself is EPIC-1007's `link_panels`. This ticket only
  propagates along links that already exist.
- This ticket does not register a WebMCP tool. It exposes apply functions
  that satisfy EPIC-1007's T-1007-7 renderer-contract interface (an
  apply function plus a validator, keyed to the `table` renderer name);
  EPIC-1007's `configure_panel_view` and `set_panel_selection` tools call
  into it. If T-1007-7 has not landed when this starts, code against the
  contract shape this epic and EPIC-1007 agreed on and use a test double.
- AC9's idempotency test must be able to detect a duplicate write — assert
  on the resulting state and revision count, not merely on the returned
  value.

## Out of Scope

- The workspace revision model, envelope, and undo mechanics (EPIC-1006).
- Establishing links between panels (EPIC-1007).
- Reading results or explanations (T-1010-4, T-1010-5).
- Rendering (T-1010-7).

## Solution Approach

### What was actually found reading `configurePanelView.ts`/`setPanelSelection.ts`

- `configurePanelView.ts` already calls
  `deps.sourceRenderer.validateRendererConfig(panel.renderer, candidate)`
  (a `SourceRendererRegistry` method resolving to the active renderer's
  `RendererTypeDefinition.validateConfig`), and `commitPanelChange`
  (`support.ts`) already does the apply + envelope. So AC1/AC3 needed no
  new hook — only a `RendererTypeDefinition` registration for `'table'`.
- Two real gaps, confirmed by reading the code (not assumed from the
  ticket):
  1. **AC2** — `describeChanges()` hard-coded `'view configuration
     updated'` whenever `request.config` was set. No hook let a renderer
     contribute its own diff text.
  2. **AC4** — `ConfigValidation<T>`'s `ok` arm had no `warnings` field at
     all (`panelKindRegistry.ts`), so even if a renderer's `validateConfig`
     wanted to report a non-blocking issue, `configurePanelView.ts` had
     nowhere to read it from and never passed anything into
     `PanelMutationResult.warnings` (which itself already existed and
     already flows into the envelope — `commitPanelChange` in `support.ts`
     was already warnings-capable, just never fed).
- `setPanelSelection.ts` confirmed exactly as the ticket's CRITICAL note
  described: **no validation hook of any kind** — `selectedIds` was stored
  and propagated to every linked panel completely unchecked, and every
  linked target received the identical array regardless of how many items
  it can actually show. AC6 and AC7 were both structurally impossible
  without new hooks.

### Additive changes to EPIC-1007's files (`src/lib/panels/*`)

All four are new *optional* members/fields — nothing existing had to
change shape, and every pre-existing renderer/kind (`chart_grid`,
`heatmap`, `scatter_plot`, every panel kind's own config validator)
continues to behave identically because it simply doesn't define the new
optional members. Proven by dedicated backward-compatibility tests (see
below), not just by "it's optional" reasoning.

1. `panels/registry/panelKindRegistry.ts` — `ConfigValidation<T>`'s `ok`
   arm gained an optional `warnings?: ConfigError[]`. Shared by
   `PanelKindDefinition.validateConfig` and
   `RendererTypeDefinition.validateConfig` (the latter re-exports the
   former's type), so this one edit lights up AC4 for both panel kinds and
   renderers going forward, not just this ticket's renderer.
2. `panels/registry/sourceRendererRegistry.ts` — `RendererTypeDefinition`
   gained three optional members:
   - `describeConfigChange?(input: { previous: TConfig; next: TConfig }): string`
     (AC2).
   - `selectionCapacity?: 'single' | 'multiple'` (AC7). Absent means
     `'multiple'` — the original unrestricted-propagation behavior.
   - `validateSelection?(input: SelectionValidationInput): SelectionValidation`
     (AC6). `SelectionValidationInput.deps` is typed `unknown`
     deliberately: `PanelUseCaseDeps` lives in `application/support.ts`,
     which already imports this file's `SourceRendererRegistry` type, so
     typing `deps` as `PanelUseCaseDeps` here would create an import
     cycle. This ticket's own `validateSelection` implementation doesn't
     need it anyway — it closes over its own `PinnedRunStore` at
     registration time, the same way `chartSourceTypeDefinition` closes
     over `ChartSourceDeps` in `chartRendererContract.ts`. `deps` is
     carried on the input purely so a *future* renderer that needs
     registry-wide context has somewhere to get it without another
     interface change.
3. `panels/application/errors.ts` — added `'invalid_selection'` to
   `PanelOperationErrorCode` (a closed union); `'invalid_config'` was
   config-shaped and didn't fit a rejected selection.
4. `panels/application/configurePanelView.ts` — `resolveConfig` now
   returns `{ config, previous, warnings }` instead of a bare config
   object; a new `describeConfigDiff` helper calls the active renderer's
   `describeConfigChange` when defined, else falls back to the original
   `'view configuration updated'` text; `warnings` flows into the
   returned `PanelMutationResult.warnings`.
5. `panels/application/setPanelSelection.ts` — a new `checkSelection`
   helper calls the active renderer's `validateSelection` when defined and
   throws `PanelOperationError('invalid_selection', ...)` on rejection
   *before* any state is touched (AC6); a new `propagatedSelection`
   helper looks up each linked target's own active renderer and, only when
   it declares `selectionCapacity: 'single'` and more than one id was
   selected, propagates only the first id and adds a warning naming what
   didn't propagate (AC7). The selecting panel itself always keeps the
   full selection it was given.

`support.ts` needed **no changes** — `PanelUseCaseDeps` already exposes
`sourceRenderer`, which is all both new hooks need to look up the relevant
`RendererTypeDefinition`.

### This ticket's own files

- `results/domain/tableConfigDiff.ts` — pure `describeResultsTableConfigChange(previous, next)`
  operating on two already-normalized `ResultsTableConfig` values: added/
  removed columns by label, sort/grouping changes, page size, computed-
  column/formatting-rule count changes, chart-panel link changes. Falls
  back to `'no changes to the table configuration'`.
- `results/application/tableConfigWire.ts` — the wire (snake_case) ↔
  domain (`ResultsTableConfig`, camelCase) boundary that did not exist
  anywhere yet (T-1010-1 only defined the domain model). `configSchema`
  and `validateConfig` on every renderer contract in this program describe
  and accept the wire shape (confirmed by reading `chartView.ts`'s
  `CHART_VIEW_CONFIG_SCHEMA`, e.g. `candle_type` not `candleType`), and
  `panel.config`'s stored keys must match the schema's declared property
  names for `recognizedRendererConfig`'s field-carry-over logic
  (`support.ts`) to work correctly across a renderer switch — so the wire
  shape, not the domain shape, is what's stored on `panel.config`.
  `parseWireResultsTableConfig` is lenient on an absent field (resolves to
  its empty default) and strict on a present field's shape; this same
  leniency is what lets `describeConfigChange` re-parse a panel's
  brand-new, still-kind-default `previous` config into a real (if empty)
  `ResultsTableConfig` instead of failing.
- `results/tools/tableRendererContract.ts` — registers `'table'` (mirrors
  `chartRendererContract.ts`'s shape) and a `'screener_results'` source
  type (`ref: { run_id }`, matching `panelState.ts`'s existing
  `REF_ID_FIELDS` convention and `defaultSourceRendererTypes.ts`'s
  existing placeholder naming). Uses the real `SourceRendererRegistry`
  type directly — the chart contract's structural workaround was written
  before that registry was on `main`; it is now, so there's nothing to
  work around. `validateConfig` composes `parseWireResultsTableConfig` +
  `validateResultsTableConfig` (T-1010-1) + `toWireResultsTableConfig`.
  `validateSelection` checks every selected id against
  `mintResultId(run.runId, match.rank)` for every match in the bound run
  (via an injected `PinnedRunStore`, read-only — `getRun`/`getMatches`
  only, never `ScreenerEvaluationPort.execute`, which is AC12's
  structural guarantee, the same one `results/ports.ts` documents for
  `ResultsReader`).
- **Not wired into `panels/shell/registerPanelTools.ts`.** Confirmed by
  reading that file: it calls `registerDefaultSourceRendererTypes`, which
  already registers a placeholder `'table'` renderer type — registering
  this ticket's real one into the *same* registry instance would throw
  `RendererTypeConflictError` (renderer names are unique per registry).
  `chartRendererContract.ts`'s `registerChartRendererContract` has the
  identical problem (`chart_grid` is also a default placeholder) and,
  confirmed by grepping the whole codebase, is never called from any
  composition root either — `registerChartTools.ts` is a *different*,
  legacy composition root gated by `CHART_TOOLS_ENABLED = false`, and
  never calls it. T-1010-7 ("results_table panel kind with selection and
  explain view") is the ticket that owns the real panel kind + UI and,
  by the same pattern EPIC-1011 established, is where the real contract
  registration finally replaces the placeholder in
  `registerPanelTools.ts`. Until then this ticket's contract is exercised
  through its own tests, which build a registry from scratch
  (`createSourceRendererRegistry()` + `registerResultsTableRendererContract`)
  rather than through `panels/application/testSupport.ts`'s
  `createPanelTestHarness()` (which always seeds the placeholder and would
  conflict the same way).

### Deviation from the ticket's assumption

The ticket's CRITICAL section anticipated needing `PanelUseCaseDeps` (or
`SourceRendererRegistry`) extended to carry a `PinnedRunStore`/
`ResultsReader` so `validateSelection` could reach it. That extension
turned out to be unnecessary: `RendererTypeDefinition` instances are
already produced by a factory function
(`createResultsTableRendererTypeDefinition(deps: ResultsTableContractDeps)`)
that closes over its own `PinnedRunStore` at *registration* time — exactly
mirroring `chartSourceTypeDefinition`'s existing `ChartSourceDeps` pattern.
`setPanelSelection.ts` never needs to know a `PinnedRunStore` exists; it
just calls `rendererType.validateSelection(...)`, and the closure already
has what it needs. This keeps `support.ts` and `PanelUseCaseDeps`
completely untouched.

### Tests

- `results/domain/tableConfigDiff.test.ts`,
  `results/application/tableConfigWire.test.ts` — unit tests for the pure
  diff and wire-mapping logic.
- `results/tools/tableRendererContract.test.ts` — registration checks plus
  full end-to-end coverage of AC1–AC12 through the real `configurePanelView`/
  `setPanelSelection` use cases (own registry + harness, as above),
  including revision-conflict, idempotency-replay (asserted on resulting
  revision count, not just envelope equality), and undo tests mutation-
  checked the way `createPanel.test.ts`'s AC12/AC13 already are.
- `panels/application/configurePanelView.test.ts`,
  `panels/application/setPanelSelection.test.ts` — new
  backward-compatibility tests proving a renderer that does **not** define
  the new hooks behaves identically to before this ticket, plus tests
  proving a renderer that *does* define them gets the new behavior. These
  use small mock `RendererTypeDefinition`s registered directly, not this
  ticket's real table contract, so EPIC-1007's own test suite stays
  self-contained.
