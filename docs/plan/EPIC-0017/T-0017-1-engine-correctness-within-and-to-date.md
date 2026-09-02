# T-0017-1: Validate `within` bounds and clamp instances to `to_date`

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

_To be filled in by `/at-ticket-design` before implementation — this ticket
was triaged with enough behavioral detail (via issue #17 plus a scoping
interview) to skip a design gate that would otherwise re-derive its own AC5-7
content, but the actual code location for `within` validation (Pydantic
validator on `SetupStep` vs. a check at the API boundary) is an implementation
decision, not a behavioral one, and should be resolved by whoever implements
this against the existing validation pattern in `backend/domain/models/pattern.py`
and `backend/api/schemas/research.py`._
