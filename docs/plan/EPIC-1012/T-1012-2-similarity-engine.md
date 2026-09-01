# T-1012-2: Similarity search engine over the price panel

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Open
**Depends on**: T-1012-1
**Blocks**: T-1012-3

## Description

With the contract fixed, this ticket makes it real: extract comparable
features from a window of price/volume history, generate candidate windows
across the universe, score them against a reference setup, and return a
ranked, pinned run. This is where the epic's actual analytical work lives.

The project already computes panel-wide derived series with pandas
`groupby`/`rolling` and extracts windows around an anchor date; that
technique is directly reusable here and is the reason the analytical layer
is Python rather than TypeScript.

## User Story

As the similarity API,
I want a searchable engine that turns a reference setup into a ranked list
of scored, explained candidates drawn from real price history,
so that the tools above it can present matches a researcher can audit.

## Acceptance Criteria

1. Given a reference window (an instrument plus a date range) the engine
   produces a feature vector covering all six feature families, computed
   from the loaded price panel.
2. Feature extraction is invariant to the things normalization is meant to
   remove: two windows with identical shape but different absolute price
   level and different bar count produce price-shape features that score as
   highly similar under the same normalization settings.
3. Given a reference setup and a search scope, the engine returns candidate
   windows ranked by descending overall score, each carrying its
   per-family measured similarities and a stable candidate ID.
4. The search scope selects between other instruments, other historical
   windows of the same instrument, and both — and the returned run states
   which scope was applied.
5. The reference window itself, and windows overlapping it, are excluded
   from its own results — a setup is not returned as a match for itself.
6. A caller-supplied weight set changes the ranking; the same search run
   with a different weight set produces a different ordering, and both runs
   report the weight set actually used.
7. Candidate count is bounded by an explicit limit, and results below a
   caller-supplied minimum score are excluded rather than padded.
8. A completed run is retrievable by its stable run ID and returns
   identical candidates and scores without recomputing the search.
9. An explanation for any candidate in a completed run is derivable from
   that run alone, and its per-family contributions reconcile to that
   candidate's score.
10. Every run reports its market-data provenance — `as_of`, source,
    live/delayed status, timezone, currency, adjusted/unadjusted price
    basis, and calculation-engine version — populated from the panel it
    searched, not hardcoded.
11. Searching against a universe with no eligible candidates returns an
    empty run with a warning explaining why (empty universe, all candidates
    below the minimum score, or insufficient history), not an error and not
    a silently relaxed search.
12. A reference window with insufficient history to compute a feature
    family degrades explicitly: that family is reported as unavailable and
    excluded from the weighted score, with the excluded families named in
    the run's warnings, rather than being scored as zero.
13. The engine is reachable through a domain-layer Protocol; the
    implementation lives in the infrastructure layer and the domain layer
    imports nothing from it.

## Design References

- `docs/plan/EPIC-1012/T-1012-1-similarity-contract.md` — the entities and
  scoring rule this implements
- `backend/infra/pandas_engine.py` — the panel-wide `groupby`/`rolling`
  technique, the anchor-relative window extraction in
  `get_instance_windows`, and the sampling strategies; also the established
  pattern of caching per-ticker frames and date-position indexes
- `backend/infra/expression.py` — the derived-series evaluator, reusable
  for study-family features
- `backend/domain/contracts/engine.py` — the Protocol style to follow
- `backend/tests/unit/test_pattern_research_engine.py` — the existing
  engine unit-test style and fixture approach

## Technical Considerations

- Relative-strength and any fundamental-flavored features depend on
  reference data from a separate parallel workstream. Consume it through
  the domain ports EPIC-1008 defines; do not build a mock pipeline for it
  and do not block on it. If the port is unavailable, AC12's explicit
  degradation path covers it — report the family unavailable.
- The existing engine keeps `PandasPatternResearchEngine` under the class
  size limit by delegating to module-level helpers; hold to the same limits
  (methods 30-40 lines, classes under 400) here.
- Cross-symbol search over a full panel is the expensive operation in this
  epic. Prefer vectorized panel-wide computation over per-candidate loops,
  as the existing engine does, and cover the cost in the test plan.
- New files only. Do not modify `pandas_engine.py` or the existing engine
  Protocol.

## Out of Scope

- HTTP routes and request/response schemas (T-1012-3).
- Persisting runs beyond the process (in-memory pinning is sufficient
  unless EPIC-1006's revision model requires otherwise).
- Rendering or comparison views.
