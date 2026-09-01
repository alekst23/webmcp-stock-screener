# T-1012-1: Similarity feature and scoring contract

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Open
**Depends on**: —
**Blocks**: T-1012-2, T-1012-6

## Description

Everything in this epic reads one shared vocabulary: what a setup's
comparable features are, how they combine into a score, and how that score
decomposes back into per-feature contributions. This ticket defines that
vocabulary once — as pure business concepts with no I/O — so the engine,
the API, the three tools, and the panel all agree on it instead of each
inventing its own shape.

The contract is expressed in both the Python domain layer and the
TypeScript type layer, because the same conceptual entities cross the
HTTP boundary in this project. It is one contract with two encodings, not
two contracts.

## User Story

As an implementer of any other ticket in this epic,
I want a single agreed definition of similarity features, weights, scores,
and contributions,
so that a candidate produced by the engine, explained by a tool, and drawn
by a panel is provably the same object throughout.

## Acceptance Criteria

1. A *feature family* is a named, enumerable concept covering exactly the
   six the design calls for: price shape, volume, volatility, relative
   strength, studies, and pattern structure. Nothing in the epic may refer
   to a feature family by an ad-hoc string.
2. A *feature weight set* assigns a weight to each family, can be
   constructed from a caller-supplied partial set with documented
   defaults for the rest, and is itself a value that can be returned to a
   caller and later supplied back unchanged.
3. A *similarity candidate* carries a stable candidate ID, the instrument
   and historical window it refers to (never a bare ticker used as the
   identifier), its overall score, and the per-family measured similarity
   that produced that score.
4. A *similarity explanation* decomposes one candidate into, per family:
   the weight applied, the measured per-family similarity, and that
   family's signed contribution to the overall score.
5. Given any candidate and its explanation, the sum of the per-family
   contributions reconciles to the candidate's reported overall score
   within a stated numeric tolerance. This is verified by test, including
   for a non-uniform weight set.
6. Scoring is a pure function of a reference feature vector, a candidate
   feature vector, and a weight set — no data access, no clock, no
   randomness. The same three inputs always yield the same score and the
   same contributions.
7. Normalization settings (as carried on a captured setup) are represented
   as a first-class value that a search records and reports, so a result
   can state the basis on which it was compared.
8. A *similarity run* is a pinned, identified result: a stable run ID, the
   reference setup ID it came from, the weight set used, the normalization
   settings applied, the market-data provenance, and its ranked candidates.
9. Market-data provenance is representable with `as_of`, source,
   live/delayed status, timezone, currency, adjusted/unadjusted price
   basis, and calculation-engine version.
10. Supplying a weight set with an unknown family name, a negative weight,
    or weights that cannot be normalized is rejected with an error naming
    the offending entry, rather than silently coerced.
11. The domain-layer definitions import nothing from the infrastructure
    layer.

## Design References

- `docs/reference/tool-spec.md` — the Similarity rows (the six feature
  families come verbatim from `explain_similarity`), and the
  "Common contract for every tool" and market-data-provenance sections
- `backend/domain/models/pattern.py`, `backend/domain/models/instance.py` —
  the existing Pydantic domain-entity style to match
- `backend/domain/models/measurement.py` — `InstanceWindow`, the existing
  "bars around an anchor" shape a candidate window resembles
- `src/lib/webmcp/types.ts` — the existing TypeScript mirror of backend
  domain entities and the naming conventions it uses

## Technical Considerations

- EPIC-1011 owns the captured-setup type. Reference it; do not define a
  competing one. If EPIC-1011's type is not yet available when this ticket
  runs, depend on it by ID and document the field expectations rather than
  inlining a substitute definition.
- EPIC-1006 owns the mutation envelope, stable-ID scheme, and provenance
  type. If EPIC-1006 has already defined provenance, consume it and treat
  AC9 as satisfied by that definition rather than duplicating it.
- AC5 is the epic's central auditability guarantee and constrains the
  scoring form: pick a combination rule under which contributions provably
  sum to the score. A rule where they do not is the wrong rule.
- Forward compatibility for EPIC-1014's `refine_similarity_search`: the
  weight set must be a plain input value that a future caller can compute
  and pass in. Nothing in scoring may depend on weights being the defaults.
- New files only. Do not modify the existing pattern-research domain models
  or `src/lib/webmcp/types.ts`.

## Out of Scope

- Computing feature vectors from real price data (T-1012-2).
- Any HTTP route, tool registration, or rendering.
- Learning or adjusting weights from feedback (EPIC-1014).
