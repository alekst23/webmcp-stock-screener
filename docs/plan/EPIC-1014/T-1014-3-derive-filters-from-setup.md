# T-1014-3: Derive a draft filter tree from a captured setup

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Open
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

## Out of Scope

- Capturing the setup itself (EPIC-1011).
- Editing the live filter tree (EPIC-1009's `edit_filter_tree`).
- Automatically running or backtesting the screener after acceptance.
- Deriving a universe, ranking, or results-table configuration from the
  setup — filters only.
