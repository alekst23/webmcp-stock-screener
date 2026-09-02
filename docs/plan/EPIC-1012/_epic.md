# EPIC-1012: Similarity Search

**Depends on**: EPIC-1006 (common tool contract), EPIC-1011 (captured
chart setup), EPIC-1007 (panel container & panel-kind registry)
**Blocks**: EPIC-1014 (`refine_similarity_search`)
**Design**: docs/design/similarity-search/

## Description

The new WebMCP surface lets a researcher capture a chart setup they like
— a symbol, a historical window, its studies, and its normalization
settings. This epic answers the obvious next question: _where else has
this happened?_ It delivers the Similarity area of
`docs/reference/tool-spec.md` — `find_similar_setups` to search other
symbols and other historical windows for setups resembling a captured
one, `explain_similarity` to break any match down into feature-by-feature
contributions, and `compare_setups` to put candidates side by side as
normalized overlays, synchronized charts, or small multiples.

The non-negotiable property is auditability. A similarity match is never
a bare score: every result carries the feature families that produced it
(price shape, volume, volatility, relative strength, studies, pattern
structure), the weight applied to each, and each one's signed
contribution to the total. `explain_similarity` is a transparency tool in
the same sense `explain_result` is for screeners — a researcher must be
able to disagree with a match and see exactly why the system proposed it.

All work lands in NEW files. The existing 11-tool pattern-research
surface (`src/lib/webmcp/tools.ts`, `src/lib/workspace/*`) and its UI are
not modified — EPIC-1015 retires them at the end of the program. `main`
stays deployable throughout.

## User Story

As a researcher who has just captured a chart setup worth studying,
I want to find, understand, and visually compare other setups that
resemble it,
so that I can judge whether the pattern generalizes — and see the
evidence behind every proposed match rather than trusting an opaque
score.

## Ticket Summary

| #   | Ticket   | Title                                                | Depends On                   | Status |
| --- | -------- | ---------------------------------------------------- | ---------------------------- | ------ |
| 1   | T-1012-1 | Similarity feature and scoring contract              | —                            | Done   |
| 2   | T-1012-2 | Similarity search engine over the price panel        | T-1012-1                     | Done   |
| 3   | T-1012-3 | Similarity search and explanation API                | T-1012-2                     | Done   |
| 4   | T-1012-4 | `find_similar_setups` tool                           | T-1012-3                     | Done   |
| 5   | T-1012-5 | `explain_similarity` tool                            | T-1012-3                     | Done   |
| 6   | T-1012-6 | `similar_opportunities` panel kind                   | T-1012-1                     | Done   |
| 7   | T-1012-7 | `compare_setups` tool and comparison views           | T-1012-6                     | Done   |
| 8   | T-1012-8 | Similarity surface wiring and provenance integration | T-1012-4, T-1012-5, T-1012-7 | Done   |

## Dependency Graph

```
T-1012-1 ──┬──> T-1012-2 ──> T-1012-3 ──┬──> T-1012-4 ──┐
           │                            │               │
           │                            └──> T-1012-5 ──┤
           │                                            ├──> T-1012-8
           └──> T-1012-6 ──> T-1012-7 ───────────────────┘
```

## Wave Plan

- **Wave 1**: T-1012-1 — the shared contract everything else reads
- **Wave 2** (parallel): T-1012-2 (engine), T-1012-6 (panel kind)
- **Wave 3** (parallel): T-1012-3 (API), T-1012-7 (comparison views)
- **Wave 4** (parallel): T-1012-4, T-1012-5 — the two search/explain tools
- **Wave 5**: T-1012-8 — wiring and end-to-end provenance

## Acceptance Criteria

1. Given a captured setup (produced by EPIC-1011's `capture_chart_setup`
   and referenced by its stable ID), a similarity search returns a ranked
   list of candidate setups — other symbols, other historical windows, or
   both — each identified by a stable candidate ID, never by bare ticker.
2. Every returned candidate carries its overall similarity score together
   with the per-feature-family breakdown that produced it: price shape,
   volume, volatility, relative strength, studies, and pattern structure.
   No candidate is ever returned as a score alone.
3. Requesting an explanation for any candidate from a completed search
   returns, for each feature family, the weight applied, the measured
   per-family similarity, and that family's signed contribution to the
   total — and the contributions reconcile to the reported overall score.
4. A search result is pinned: the candidates, explanations, and comparison
   views for one search are all reproducible from that search's stable run
   ID without silently re-running the search.
5. Candidates can be displayed for comparison in at least three forms —
   normalized overlays, synchronized charts, and small multiples — with
   the captured setup itself included as the reference in each form.
6. The normalization settings carried by the captured setup govern how
   candidates are compared and rendered, and the settings actually applied
   are stated in the results, so comparability is never assumed.
7. Every similarity result and comparison view states its market-data
   provenance: `as_of`, source, live/delayed status, timezone, currency,
   adjusted/unadjusted price basis, and calculation-engine version.
8. Feature weights are an explicit, inspectable input to a search, defaulted
   when not supplied and echoed in every response — so a later
   `refine_similarity_search` (EPIC-1014) can supply an adjusted weight set
   without any change to the search, explanation, or comparison contracts.
9. Mutating similarity tools honor the common contract from EPIC-1006 —
   `expected_revision`, `idempotency_key`, and a mutation envelope carrying
   `change_id`, `new_revision`, `affected_ids`, `diff_summary`, `warnings`,
   and `undo_token`.
10. The `similar_opportunities` panel is registered through EPIC-1007's
    panel-kind registry and behaves like any other panel in the container
    (add, update, layout, link, remove) with no special-casing.
11. The existing 11-tool pattern-research surface and its UI are unchanged;
    the app builds, tests pass, and `main` remains deployable.

## Design References

- `docs/reference/tool-spec.md` — the program's tool surface; this epic
  implements its "Similarity" rows and the common-contract and
  market-data-provenance rules that apply to them
- `docs/design/similarity-search/spec.md` — the behavioral spec for this
  epic (written alongside it)
- `backend/domain/models/` and `backend/domain/contracts/engine.py` —
  the existing domain-entity and Protocol style this epic follows
- `backend/infra/pandas_engine.py` and `backend/infra/expression.py` —
  reusable technique: panel-wide `groupby`/`rolling` feature computation
  and window extraction around an anchor date
- `backend/domain/models/measurement.py` (`InstanceWindow`) — the existing
  "window of bars around an anchor" shape the comparison views build on

## Open Questions

These are not answered by `docs/reference/tool-spec.md`. Each carries the
assumption the tickets are written against; revisit if the program
decides otherwise.

1. **Search scope shape.** The spec says "symbols or historical windows"
   without saying whether that is one tool or two modes. _Assumption_: one
   tool with an explicit scope discriminator (cross-symbol, historical
   windows of the same symbol, or both), so the caller states intent
   rather than the system guessing.
2. **Candidate universe bounds.** The spec does not state a default
   universe or result cap. _Assumption_: when the workspace has a screener
   bound, its universe scopes the search; otherwise a bounded default
   universe applies. Results are capped and paged from the pinned run.
3. **Default feature weights.** Not specified. _Assumption_: equal weight
   across the six named families, always echoed in the response so the
   default is visible rather than hidden.
4. **Similarity metric.** Not specified. _Assumption_: each family yields a
   normalized per-family similarity, and the overall score is their
   weighted combination — chosen specifically so contributions reconcile
   to the total and AC3 is checkable.
5. **Where `compare_setups` renders.** The spec does not say whether it
   creates a panel or reconfigures one. _Assumption_: it targets an
   explicit panel ID, defaulting to the `similar_opportunities` panel bound
   to the search run.

## Out of Scope

- `refine_similarity_search` — adjusting weights from accepted/rejected
  matches belongs to EPIC-1014. This epic only guarantees the weight model
  is an explicit input so that work needs no contract change here.
- `derive_filters_from_setup` — converting a setup into a filter tree.
- `capture_chart_setup` and the captured-setup type itself (EPIC-1011).
- The panel container, layout, and linking machinery (EPIC-1007); this epic
  contributes one panel kind to that registry.
- The workspace/revision model, undo tokens, and mutation envelope
  (EPIC-1006); this epic consumes them.
- Reference and fundamental market data sourcing — a separate parallel
  workstream. This epic consumes it only through the domain ports EPIC-1008
  defines and builds no mock pipeline for it.
- Backtesting a similarity result or measuring forward returns on
  candidates.
- Modifying, refactoring, or retiring the existing 11-tool surface
  (EPIC-1015).
