# T-0017-1: Validate `within` bounds and clamp instances to `to_date`

**Status**: Done
**Design**: docs/design/pattern-research-workbench/
**Depends on**: —
**Resolves #17**

## Description

Two independent correctness defects in `backend/infra/pandas_engine.py` and
`backend/domain/models/pattern.py`, found while mapping the engine's
semantics for the (since-closed) DuckDB port. Both are wrong on `main` today.
This is a behavior-changing bug fix, not new capability — see Blockers/Decisions
context in `docs/plan/project.md` on why this is triaged as a normal fix rather
than held for EPIC-1015 (user decision 2026-09-02: the legacy engine is live
until EPIC-1015 actually deletes it, so a correctness bug in it is real risk
until then).

## Acceptance Criteria

1. `SetupStep.within = (min, max)` is validated at setup-definition time
   (`Setup`/`SetupStep` construction, wherever a setup is currently accepted
   into the domain — model validation or the API boundary, whichever the
   existing pattern uses elsewhere in this file). A negative `min`, or a
   `max` below `min`, is rejected with an error message naming the offending
   step index and the bad bound(s). No new setup with an impossible window
   can be constructed.
2. Existing setups are unaffected unless they actually declare an impossible
   `within` — this is validation of new input, not a retroactive scan of
   anything already stored.
3. In `find_instances`, every step's resolved date — not just the anchor
   step's — is bounded by the search range (`[from_date, to_date]` after
   defaults are applied). A candidate instance whose final (or any
   intermediate) step resolves to a date after `to_date` is excluded from
   results, matching the anchor's existing bound check at
   `backend/infra/pandas_engine.py:179`.
4. This is a deliberate, documented behavior change: some previously-returned
   instances (those whose completion fell after `to_date`) will no longer
   be returned. Note it in the PR/commit body, not as a code comment
   (project convention).
5. In-progress/partial instance handling (spec: "Sparse completed matches")
   is unaffected — an instance still in progress at the end of the covered
   range is a partial match, not an out-of-bounds completed one; only a
   *completed* instance dated after `to_date` is newly excluded.
6. Tests exist for both fixes, each failing without its corresponding fix:
   - a setup with `min > max` and with a negative `min` are both rejected
     at construction, with the offending step/bounds identifiable from the
     error;
   - a multi-step setup search returns a candidate whose anchor is inside
     `[from_date, to_date]` but whose final step resolves after `to_date`
     — asserted absent from results (currently present, per issue #17).
7. `docs/design/pattern-research-workbench/spec.md`'s "Temporal setup
   definition" and "Instance search" tables reflect both corrected
   behaviors (see spec update in this same commit).

## Solution Approach

- **`within` validation**: a `@model_validator(mode="after")` on `Setup`
  (not a field validator on `SetupStep`), matching the existing pattern in
  `domain/models/similarity.py`'s `MarketDataProvenance`. It lives on `Setup`
  rather than `SetupStep` because the required error message ("naming the
  offending step index") needs the step's position in the sequence, which a
  standalone `SetupStep` has no way to know. This validates both
  construction sites for free: `pandas_engine.define_setup` and the API
  boundary (`FindInstancesRequest.setup: Setup`), since pydantic runs nested
  model validation either way.
- **`to_date` clamp**: `_search_all_tickers` now computes, per ticker, where
  `to_date` falls in that ticker's own date series
  (`np.searchsorted(date_codes, to_code, side="right")`) and passes that as
  the walk's usable length instead of the ticker's full row count. This
  reuses the walk's existing "partial" handling for the panel's physical
  trailing edge — a step whose window runs past the `to_date` boundary is
  now also "partial" (still in progress) rather than a decisive match,
  which is what AC5 requires. No change to `_walk_anchor`'s decision logic
  was needed, only what `length` value it's called with.
