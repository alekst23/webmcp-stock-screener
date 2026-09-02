# T-1014-3: Derive a draft filter tree from a captured setup

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Done
**Depends on**: — (consumes EPIC-1011's captured setup and EPIC-1009's
filter tree)
**Blocks**: T-1014-11
**Issue**: —

## Description

Deliver `derive_filters_from_setup`: turn a captured chart setup — "find
me more like this one" — into an editable **draft** filter tree the
researcher can read, prune, and then accept onto a screener.

The draft-ness is the point. A derived filter tree is a guess made from
one example; applying it straight to a live screener would silently
replace filters the researcher built deliberately. The tool produces a
proposal with a stable ID, each condition traceable to the characteristic
of the setup that produced it, and a separate explicit step applies it.

## User Story

As a researcher who has found one chart that looks exactly right,
I want a starting filter tree derived from it that I can read and edit
before it touches my screener,
so that the example becomes a first draft I refine rather than an opaque
black box that overwrites my work.

## Acceptance Criteria

1. `derive_filters_from_setup` accepts a captured setup ID and returns a
   draft filter tree with a stable draft ID.
2. The draft's conditions use the screener's typed condition model —
   scalar, range, series comparison, temporal, event-relative, pattern,
   relative, and study-output conditions as applicable — rather than any
   new or free-form condition form.
3. Each derived condition states which characteristic of the setup
   produced it, so the researcher can judge and prune it.
4. Creating a draft does not change any screener's live filter tree.
   Inspecting the screener after derivation shows it unchanged.
5. A draft can be edited: a condition can be updated, removed, disabled,
   or regrouped, and the result is still a draft.
6. A draft can be explicitly accepted onto a target screener, at which
   point that screener's filter tree becomes the draft's contents as one
   reversible change.
7. When the setup references a field or study with no data available for
   the target universe, the affected conditions are omitted or created
   disabled, and a warning names each one and the reason.
8. When nothing in the setup maps to a supported condition type, an empty
   draft is returned with a warning explaining why — not an error.
9. Derivation accepts `expected_revision` and `idempotency_key` and
   returns the common mutation envelope; the same is true of the accept
   step. A repeated `idempotency_key` does not produce a second draft or
   apply the acceptance twice.
10. Undoing an acceptance with the returned undo token restores the
    screener's previous filter tree exactly.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Derive filters from a
  setup" scenario table.
- `docs/reference/tool-spec.md` — `derive_filters_from_setup` ("convert an
  example chart into an editable draft filter tree"); the eight
  `edit_filter_tree` condition types the draft must be expressed in.
- `docs/plan/EPIC-1011/_epic.md` — `capture_chart_setup`'s contract: what
  a captured setup records (symbol, historical window, studies,
  normalization) and therefore what is available to derive from.
- `docs/plan/EPIC-1009/_epic.md` — the typed filter-tree condition model
  and the screener the draft is accepted onto.
- `docs/plan/EPIC-1006/_epic.md` — mutation envelope, revisions, undo.

## Technical Considerations

- Derivation is inherently lossy and heuristic. Being explicit about
  what each condition came from matters more than deriving many
  conditions — a short, legible draft beats a long, unexplained one.
- Widths and thresholds derived from a single example are guesses. Prefer
  ranges with stated tolerances over exact-value equality conditions,
  and say so in the condition's explanation.
- A draft is a first-class resource with its own ID and lifetime; do not
  model it as a mutation on the screener that happens to be flagged.
- If EPIC-1013's preview/apply layer is available, accepting a draft is a
  natural fit for it; coordinate rather than building a second apply
  path.

## Solution Approach

### Why one tool, three operations

`docs/reference/tool-spec.md` names exactly one tool for this ticket:
`derive_filters_from_setup`. Sibling epics already establish the pattern
of one WebMCP tool covering several structural operations behind an
`operation` field (`edit_filter_tree`'s `add/update/remove/group/
set_enabled/reorder`). This ticket follows the same shape: one registered
tool, `operation: 'derive' | 'edit' | 'accept'` (default `'derive'`).
This keeps the tool surface matching the spec literally while still
satisfying AC5 (edit) and AC6 (accept) as first-class, envelope-returning
capabilities, each going through EPIC-1006's single write path
(`RevisionService.commit`) like every other mutation in the program.

Each of the three operations is also registered as its own
`OperationDefinition` (`screener.derive_filter_draft`,
`screener.edit_filter_draft`, `screener.accept_filter_draft`) in
EPIC-1006's shared `operationRegistry`. That makes them automatically
batchable and previewable through EPIC-1013's `preview_workspace_changes`
/ `apply_previewed_changes` (already on `main`) with no second apply path
of this ticket's own invention -- directly satisfying the ticket's
"coordinate rather than building a second apply path" guidance, since
EPIC-1013 does exist on `main`.

### Why a new resource, not a flagged screener

Per the ticket's explicit instruction, a draft is its own resource with
its own stable ID and lifetime -- never a screener with a "draft" flag.
It is stored in `WorkspaceDocument.extensions` under its own key
(`filter_drafts`), mirroring EPIC-1011's `capturedSetup.ts` pattern
(`CAPTURED_SETUP_EXTENSION_KEY` / `readCapturedSetup` / `writeCapturedSetup`)
exactly: normalize-on-read, copy-on-write, never a live reference.

The draft's tree (`FilterNode`) is EPIC-1009's own type, built and edited
through EPIC-1009's own pure `filterTree.ts` functions (`addFilterNode`,
`updateFilterCondition`, `removeFilterNode`, `groupFilterNodes`,
`setFilterNodeEnabled`, `reorderFilterChildren`) -- those functions
operate on any `FilterNode`, not specifically a screener's, so reusing
them for a draft's tree is a legitimate consumption of EPIC-1009's public
contract, not a modification of it. Per-condition provenance ("which
setup characteristic produced this condition") cannot live on
`ConditionNode` itself (that type is owned by EPIC-1009 and is not
modified by this ticket), so it is carried as a parallel array on the
draft: `provenance: { nodeId, characteristic, explanation }[]`. A node's
absence from this array means it was added or edited by hand after
derivation, which is itself informative.

Draft resource IDs use the existing closed `ResourceKind` set via the
`'filter'` kind with a `'draft'` discriminator (`ids.next('filter',
'draft')` -> `filter_draft_1`), exactly the discriminator mechanism
`docs/plan/EPIC-1006` already established for e.g. `panel_chart_1` --
no change to `workbench/domain/ids.ts`'s closed `ResourceKind` union.

### Derivation heuristic (deliberately small and disclosed)

`CapturedChartSetup` (EPIC-1011) does not record computed indicator
*values* or OHLC prices at capture time -- only chart *configuration*
(instrument, window, studies with resolved params, annotations, candle/
scale/adjustment/normalization policy). So the heuristic derives only
from characteristics that carry a concrete, traceable signal:

1. **Attached, enabled studies** (`setup.studies`, `enabled === true`)
   each become one `study_output` condition: `studyId` = the study's
   catalog ID, `params` = its captured params, `outputName` = the
   study's first declared catalog output, `predicate: 'rising'`. The
   predicate is a disclosed guess (no computed value is available to
   know the true direction) -- every such condition's explanation says
   so explicitly and names the study.
2. **Price-bearing annotations** (`price_level`, `label`, `trendline`)
   each become one `range` condition on `field.price.close`, a tolerance
   band (±2%, `DRAFT_PRICE_TOLERANCE`) around the annotated price (or
   around the trendline's two endpoints), per the ticket's "prefer
   ranges with stated tolerances over exact-value equality" guidance.
   `date_range`/`setup_window` annotations carry no price and are not
   mapped.
3. Everything else captured (instrument identity, window/timeframe,
   candle type, scale, normalization, comparisons) has no sensible
   mapping onto a *filter* condition (matching a universe of instruments)
   and is left alone -- deriving a universe or ranking from the setup is
   explicitly out of scope.

Conditions are derived in a fixed, deterministic order (studies in their
chart `order`, then annotations in array order) and capped at
`MAX_DRAFT_CONDITIONS = 6` total, so the draft stays short; anything
beyond the cap is dropped with a warning naming the count, per the
ticket's "a short, legible draft beats a long, unexplained one."

### Availability (AC7) and "nothing derivable" (AC8)

For each candidate condition, every catalog item it names (the study, or
`field.price.close` for a range condition) is resolved through the
injected `CatalogRegistry` and checked against
`item.availability.status`. `'unavailable'` items in this catalog (e.g.
`study.rsi`, `study.macd`, `study.bollinger_bands`, `study.vwap`) are
never silently included: the condition node is still added to the tree
(so the researcher can see what was skipped and toggle it on later) but
with `enabled: false`, and a warning names the item and its catalog
`availability.reason`. This directly exercises AC7 with real seeded
catalog data (no fixture needed): a captured RSI study derives a
disabled `study_output` condition plus a warning.

AC8 is the separate case where the *setup itself* has nothing to derive
from at all -- no enabled studies and no price-bearing annotations. That
returns an empty draft (a bare root group with no children) and a single
warning explaining why, never an error. This is deliberately a different
code path from AC7 (which always produces at least one, disabled, node)
so the two acceptance criteria stay independently testable.

### File layout

New files only, under a new `src/lib/workbench/screener/` area (the
`workbench/<epic>/{domain,application,tools}` shape the ticket's key
context points at -- `workbench/chart`, `workbench/similarity` --
mirrored here rather than added to the already-gated, not-yet-registered
`src/lib/webmcp/screener/` from EPIC-1009):

- `domain/filterDraft.ts` -- `FilterDraft`, `DraftConditionProvenance`
  types; extension-key read/write/normalize (mirrors `capturedSetup.ts`);
  wire serializer. Includes a small local `FilterNode` normalizer
  (duplicated from EPIC-1009's private, unexported
  `normalizeFilterNode`/`normalizeGroupNode`/`normalizeConditionNode`
  rather than requesting an export be added there, to avoid a cross-epic
  edit to already-merged code) so a persisted draft degrades safely
  instead of throwing, consistent with the rest of the program's
  normalize-on-read convention.
- `application/deriveFilters.ts` -- the pure heuristic
  (`deriveDraftConditions`) plus the `screener.derive_filter_draft`
  `OperationDefinition`.
- `application/filterDraftOperations.ts` -- the `screener.
  edit_filter_draft` and `screener.accept_filter_draft`
  `OperationDefinition`s. Accept reads the target screener via
  EPIC-1009's `readScreener`/`writeScreener`, replaces its `filterTree`
  wholesale with the draft's tree, and sets `inverse` to the
  pre-acceptance document -- the same pattern `editFilterTree.ts`
  already uses for its own undo token, so AC10 falls out of EPIC-1006's
  existing undo machinery with no new mechanism.
- `tools/deriveFiltersFromSetup.ts` -- the single `ToolSpec`, dispatching
  on `operation`, translating wire snake_case, mapping typed errors to
  `ToolResult` failures (mirrors `chart/tools/captureChartSetup.ts`).
- `tools/registerFilterDraftTools.ts` -- composition root, gated behind
  `FILTER_DRAFT_TOOLS_ENABLED = false` and not called from app startup,
  matching every sibling "new surface" composition root
  (`registerChartTools.ts`, `registerSimilarityTools.ts`) until
  T-1014-11 does whole-surface integration.

Tests alongside each file (`*.test.ts`), plus a mutation check for every
new test: each is verified to fail when the corresponding fix/derivation
rule is reverted.

## Out of Scope

- Capturing the setup itself (EPIC-1011).
- Editing the live filter tree (EPIC-1009's `edit_filter_tree`).
- Automatically running or backtesting the screener after acceptance.
- Deriving a universe, ranking, or results-table configuration from the
  setup — filters only.
