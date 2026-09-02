# T-1010-7: `results_table` panel kind with selection and explain view

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Open
**Depends on**: T-1010-4, T-1010-5, T-1010-6
**Blocks**: T-1010-8

## Description

The human-visible half of the Results area: a `results_table` panel kind
registered with EPIC-1007's panel registry that renders a run's paged
results with the configured columns, grouping, and conditional formatting,
lets the person select rows, and surfaces the per-instrument explanation.
Whatever the agent does through the tools, the person sees here.

## User Story

As a researcher sitting next to the agent,
I want to see the results table it configured, click through it myself,
and open the explanation for any row,
so that I can follow and check the agent's work instead of taking its
word for the outcome.

## Acceptance Criteria

1. A `results_table` panel kind is registered with the panel registry and
   can be added to a workspace as a panel.
2. The panel renders the current page of its bound run's results using the
   configured columns and their labels and units, in the configured sort
   order.
3. Grouping, when configured, is rendered as visible groups.
4. Conditional formatting rules are applied to the cells they target, and
   a rule that matches no rows leaves the table unchanged rather than
   erroring.
5. The panel provides paging controls that request the next and previous
   pages and never trigger a screener run; the total result count is
   visible.
6. Provenance for the displayed page — `as_of`, source, live/delayed
   status, timezone, currency, price adjustment policy, fundamentals
   reporting period, and calculation-engine version — is visible or
   reachable from the panel without leaving it.
7. The person can select one or more rows directly, and that selection is
   the same selection the agent reads and writes.
8. A selection made in the panel propagates to linked chart and details
   panels, the same way an agent-driven selection does.
9. Every visible row offers a way to open its explanation, which shows
   every filter condition with its threshold, the instrument's actual
   value, and its pass / fail / indeterminate outcome, laid out so the
   `AND`/`OR`/`NOT` grouping is legible, plus the ranking contribution
   breakdown.
10. A run that matched nothing renders an explicit empty state; an expired
    or unknown run renders an explicit message telling the person the
    screener needs to be run again, rather than an empty table.
11. A panel whose run is still loading, and one whose read failed, each
    render a distinguishable state rather than a blank panel.
12. The existing pattern-research UI and its panels are unchanged and
    continue to work.

## Design References

- `docs/design/results-and-explain/spec.md` — all four feature sections;
  the panel is where their outcomes become visible.
- `docs/plan/EPIC-1010/T-1010-4-paged-results-use-case.md` and
  `T-1010-5-explain-result-use-case.md` — the reads this panel performs.
- `docs/plan/EPIC-1010/T-1010-6-configure-and-select-mutations.md` — the
  selection mutation a human click goes through.
- `src/lib/workspace/GridPanel.svelte` and
  `src/lib/workspace/WorkspaceView.svelte` — existing panel rendering
  conventions to follow. Not modified by this epic.

## Technical Considerations

- The panel container and registry are EPIC-1007's; register into them
  rather than building panel chrome.
- A human click on a row must go through the same selection mutation the
  agent uses (T-1010-6), so the two never diverge — this is what makes AC7
  true rather than incidentally true.
- Keep the table virtualization-agnostic: the page is already bounded, so
  no windowing machinery is needed at this size.

## Out of Scope

- The panel container, panel chrome, and `link_panels` (EPIC-1007).
- WebMCP tool registration (T-1010-8).
- Any change to the existing pattern-research UI (EPIC-1015).

## Solution Approach

### 1. The `PanelFrame` prop-passing gap (flagged for review)

Confirmed by reading `PanelFrame.svelte`, `PanelContainer.svelte`, and
`panelController.ts`: `PanelKindDefinition.component()` is a zero-arg loader,
`resolvePanelBody` normalizes its result into `ResolvedPanelBody`, and
`PanelFrame` renders a resolved real component as `<Body />` with **no
props** — while two lines below, the placeholder path renders
`<PlaceholderPanelBody {panel} {kindDefinition} {linkedValue} {onBroadcast}
/>`. A real per-kind body has no way to learn which panel instance it is
mounted as (`panel.id` for the bound run, `panel.config` for table
configuration) or to receive a same-page broadcast. Nothing in the code or
its comments suggests this was deliberate — every placeholder comment frames
itself as being "replaced by a real, kind-specific body," implying parity of
inputs.

**Do we need `onBroadcast`?** Investigated `propagateLinkedValue` /
`handleBroadcast` in `PanelContainer.svelte`: this is a client-render-only,
same-page value channel that every placeholder body exposes as a manual
"broadcast a value on a channel" test form — it never touches workspace
state and is unrelated to T-1010-6's real selection-propagation path
(`setPanelSelection.ts`'s `propagationTargets` + renderer `validateSelection`
hooks, which already fully implements AC8). This panel does not need
`onBroadcast` to satisfy any acceptance criterion; it is included in the
fix anyway, for parity with every other future real panel kind (chart,
watchlist, similarity, alerts, symbol details) that may want the same manual
broadcast affordance placeholders have today, and because withholding it
selectively would make the fix results-specific rather than generic.

**Fix applied** (`src/lib/panels/shell/panelController.ts` +
`src/lib/panels/shell/PanelFrame.svelte`):

- Added `PanelBodyProps` (`{ panel: Panel; linkedValue?: LinkedValueEntry;
  onBroadcast: (channel: PanelLinkChannel, value: string) => void }`) —
  exactly `PlaceholderPanelBody`'s own prop shape minus `kindDefinition`
  (redundant for a real body: a kind-specific component already knows its
  own kind statically at registration time, unlike the generic placeholder
  which needs it to render an arbitrary kind's dl/broadcast form).
- `ResolvedPanelBody`'s `'component'` arm is now `{ kind: 'component';
  component: (props: PanelBodyProps) => unknown }` (was `(...args: never[])
  => unknown`, which could not be invoked with any props at all).
  `normalizeComponent` returns the same shape, cast, so the "unwrap `{
  default: fn }`" logic is unchanged.
- `PanelFrame.svelte` now renders `<Body {panel} {linkedValue}
  {onBroadcast} />`.

This is additive and backward compatible: no existing placeholder kind is
affected (they still resolve to `'placeholder'`, never `'component'`), and
every future sibling epic's real panel kind receives the same three pieces
of per-instance data this ticket needed, not a results-specific prop.
**Flagging per the orchestrator's instruction**: this is a shared shell
edit, not final until reviewed the same way `setPanelSelection.ts` and
`ScreenerRun` needed a second look earlier in this epic run.

### 2. Registering the real kind and renderer contract without editing the placeholder files

`registerDefaultPanelKinds`/`registerDefaultSourceRendererTypes` register
placeholders unconditionally and their own `register*` calls throw on a
duplicate name — so simply calling the real registration after the
defaults (or before) would throw `PanelKindConflictError` /
`RendererTypeConflictError` for `results_table` / `table` /
`screener_results`, all three already claimed by the placeholders.

Rather than hardcode an exclusion list for `results_table` (which the
files' own comments promise never to need — "no edit to this file
required"), `registerDefaultPanelKinds` and
`registerDefaultSourceRendererTypes` were changed to skip any kind/renderer/
source name **already present** in the registry, instead of registering
unconditionally. This is additive and generic: starting from an empty
registry (every existing test, and every other composition root) behaves
identically; the only newly-reachable path is "a real definition was
registered first, so the matching placeholder is skipped." This is exactly
the composition-root pattern `defaultPanelKinds.ts`'s own comment already
promises sibling epics, made to actually work — every future sibling kind
(chart, watchlist, similarity, alerts, symbol details) gets the same
override-by-registering-first behavior with no further change to either
file.

`src/lib/panels/shell/registerPanelTools.ts` (`createDefaultPanelShellRuntime`
-- the actual composition-root function; `src/lib/panels/application/support.ts`
is a different file, the use-case plumbing shared by every panel mutation)
now:

1. builds `kinds`/`sourceRenderer` (empty registries) and a
   `createPinnedRunStore()` instance,
2. registers the real `results_table` kind (`createResultsTablePanelKindDefinition`)
   and the real table renderer contract (`registerResultsTableRendererContract`,
   T-1010-6) against them, closing over the shared `PinnedRunStore` and the
   full `PanelToolDeps` (built earlier in the same function, before the
   default-seeding call) so the panel's own reads/mutations and the
   renderer's `validateSelection` hook agree on one run store,
3. then calls `registerDefaultPanelKinds`/`registerDefaultSourceRendererTypes`
   for the remaining seven placeholder kinds and three placeholder
   source/renderer types, which now skip `results_table`/`table`/
   `screener_results` because they're already registered.

### 3. On "who wires the renderer contract" (T-1010-6 vs. T-1010-8 vs. this ticket)

T-1010-6's own report and this ticket's own `## Technical Considerations`
disagree with the checked-in ticket doc for T-1010-8, whose AC1 also claims
"the table-renderer contract is registered into EPIC-1007's source/renderer
registry" as part of *its* scope. Per the orchestrator's explicit
instruction (which re-derived this from T-1010-6's report: wiring the real
renderer contract in is this ticket's job, matching the precedent that
EPIC-1011's chart panel kind is expected to do the same for `chart_grid`),
this ticket wires `registerResultsTableRendererContract` into the
composition root now — see #2 above. `getScreenerResults`/`explainResult`
do not depend on the renderer registry at all (they read `PinnedRunStore`
directly), so this panel would render correctly either way; wiring the
contract now is what makes `AC7`'s "the same selection mutation" actually
exercise T-1010-6's `validateSelection` run-membership check end to end,
rather than merely calling a function that silently accepts anything
because no renderer type is registered under `panel.renderer`. T-1010-8
still owns registering `get_screener_results`/`explain_result` as WebMCP
tools and the end-to-end agent-facing test; its AC1 claim about the
renderer contract is already satisfied by this ticket and should be
corrected or treated as re-confirmed, not redone. **Flagging this
discrepancy explicitly for the orchestrator**, per the same instruction.

### 4. Dependency injection for the lazy-loaded panel component

`PanelKindDefinition.component()` is a zero-arg loader returning a real
Svelte component (a compiled function Svelte's own `<Body ... />` syntax
instantiates internally) — there is no way to hand it kind-specific
constructor arguments beyond the generic `PanelBodyProps` from fix #1, and
wrapping the compiled component in a hand-written forwarding function is not
safe (Svelte 5's component calling convention is internal, not a plain
`(props) => output` call).

Instead, `src/lib/results/panel/resultsPanelContext.ts` holds a small
module-scoped `ResultsPanelRuntimeDeps` (the shared `PanelUseCaseDeps` +
`PinnedRunStore` + optional ticker resolver) set once, synchronously, by
`createResultsTablePanelKindDefinition(...)` at registration time (before
`component()` is ever called) — the same "closes over its own dependency at
registration time" pattern `tableRendererContract.ts` already established
for its `PinnedRunStore`. `ResultsTablePanel.svelte` reads it via
`getResultsPanelRuntimeDeps()`, with an optional `deps` prop override (unused
by `PanelFrame`, since it is not part of `PanelBodyProps`) so component
tests can mount it directly with an explicit, isolated dependency set
instead of relying on module-global state.

### 5. Reading the page, paging, and the four non-happy-path states (AC10, AC11)

`getScreenerResults` is synchronous (`PinnedRunStore.getRun` has no I/O), so
there is no real async gap — but the component still models an explicit
`outcome: GetScreenerResultsOutcome | null` state, initialized to `null` and
populated inside an `$effect` (which runs after the first render, mirroring
`PanelFrame`'s own already-established "loading while the effect hasn't run
yet" pattern for its dynamic `component()` load) so "loading" is a real,
observable, testable render frame rather than a state that's impossible to
reach. The read is wrapped in `try/catch`; a thrown exception renders the
distinct "read failed" state (AC11) defensively, even though no code path in
`getScreenerResults` currently throws.

Cursor state (`cursor: string | null`) lives in local component `$state`,
never in workspace/panel config — paging never calls anything but
`getScreenerResults` (AC5), so a mutation-check test asserts the "next page"
handler never touches `setPanelSelection`/`commitPanelChange` or any
`ScreenerEvaluationPort`-shaped dependency (there isn't one in scope at all,
structurally, matching `getScreenerResults.ts`'s own "no silent rerun"
comment).

State branches, in priority order: (1) no `screener_results` source bound →
plain "not bound" message; (2) `outcome === null` → loading; (3) a thrown
exception, or `outcome` is a `PageSizeRejected`/`CursorRejected` (should not
happen — this component owns and always supplies a valid cursor/page size —
but handled defensively rather than assumed impossible) → "read failed";
(4) `outcome` is `RunNotAvailable` (`reason: 'unknown' | 'evicted'`) → AC10's
"run again" message, reusing the use case's own message text (already
extended with "Run the screener again..." by `explainResult.ts`'s sibling
convention — `getScreenerResults` does not append that suffix today, so the
panel appends the same wording itself for consistency); (5) a real page with
`total === 0` → AC10's empty-match state; (6) otherwise → the table.

### 6. Rendering columns, grouping, and formatting

`DisplayColumn` already carries `label`/`unit`/`valueType` (T-1010-1), so no
catalog lookup is needed to render a header or format a cell — only to
*validate* a config change, which stays in `tableRendererContract.ts`/
`configurePanelView.ts`, untouched by this ticket. When `config.columns` is
empty (the documented default — `defaultResultsTableConfig()`/
`defaultWireResultsTableConfig()` both yield `[]`), the panel falls back to
displaying the base identity fields every `ResultRow` already carries (rank,
ticker-or-instrument-id, composite score) — a rendering-layer decision
(`src/lib/results/panel/defaultColumns.ts`), not a domain one; AC2 only
requires that *configured* columns render in the *configured* order, and
this default keeps an unconfigured table from rendering as literally
nothing.

Grouping (AC3): `projectResultRows` sorts by the configured sort key, not
necessarily by the grouping key, and attaches `groupValue` per row without
reordering for it — the domain layer's own, deliberate scope (T-1010-4).
Rendering therefore groups by **contiguous run** in the already-sorted page
order (`src/lib/results/panel/rowGrouping.ts`'s `groupRowsByAdjacentValue`)
rather than re-sorting rows by group value, which would silently violate
AC2's "in the configured sort order." When sort and grouping keys agree
(the expected configuration), this produces clean, non-repeating groups;
when they don't, the same group value can legitimately appear more than
once on a page — an honest reflection of the configuration, not a bug this
ticket silently papers over.

Conditional formatting (AC4): `src/lib/results/panel/cellFormatting.ts`'s
`resolveCellStyle(row, columnId, rules)` is a pure function over
`ProjectedRow.columns` + `FormattingRule[]`; a rule whose predicate matches
no row simply never contributes a style anywhere, which is what "leaves the
table unchanged" means operationally — there is no code path that touches a
cell's style without a matching rule.

### 7. Selection and the explain view

Row selection calls `setPanelSelection(useCaseDeps, { context: { actor:
'human' }, panelId: panel.id, selectedIds })` directly — the same use case
`set_panel_selection` calls, with `actor: 'human'` matching this codebase's
existing convention for a UI-triggered mutation (`src/lib/workspace/
ChartToolbar.svelte`'s own `recordAction(activity, 'human', ...)` calls).
AC8 (propagation to linked panels) needs no extra code in this panel: it is
already `setPanelSelection`'s own `propagationTargets` logic. The panel's
*own* current selection (to render row highlighting) is read fresh via
`readPanelState(deps.repository.get(deps.workspaceId)).selections[panel.id]`
inside the same reactive effect that re-reads the page — driven by `panel`
being a freshly-constructed object on every `PanelContainer` re-render after
any mutation notifies, which this component depends on via `$effect`.

The explain view (`ResultsExplainView.svelte` + recursive
`ExplainFilterNode.svelte`) calls `explainResult(deps.runs, runId,
instrumentId)` per row on demand (not prefetched for the whole page) and
renders `FilterNodeExplanation`'s existing `restatement`/`operatorLabel`/
`actualValue`/`outcome` fields verbatim (T-1010-3 already derived these via
`explanationRestatement.ts` — this ticket does not re-derive a condition's
threshold text), recursing into `GroupExplanation.children` with the node's
`op` (`and`/`or`/`not`) shown as a label so the boolean structure stays
legible, plus `RankingExplanation.fields` for the contribution breakdown.

### 8. Colors and styling

All new `.svelte` files use only `var(--token)` references already defined
in `src/lib/theme/tokens.ts` (enforced repo-wide by `paletteGuard.test.ts`
across every `.svelte` file, not just the ones it names explicitly) — no new
color literals. Pass/fail/indeterminate in the explain view reuse existing
roles (`--error` for fail, `--warning` for indeterminate, default text color
plus a check glyph for pass, since there is no dedicated "success" role in
the palette) rather than inventing one.
