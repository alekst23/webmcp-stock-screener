# T-1009-8: `validate_screener` tool

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: T-1009-2, T-1009-5, T-1009-6
**Blocks**: T-1009-10

## Description

A dry run for a screener: everything that can be known without executing
it. Reports invalid parameters, data that will not be there, filters that
cannot both hold, queries that will be expensive, and universes that are
empty — so an agent fixes the screen before spending a query on it, and a
human sees why a screen returned nothing before it runs.

## User Story

As an AI agent about to run a screen,
I want a check that tells me what is wrong with it and how badly,
so that I correct a contradiction or a missing field on this turn instead
of interpreting an empty result as a market fact.

## Acceptance Criteria

1. Validating a well-formed screener reports it as valid with no blocking
   problems and states the screener revision that was validated.
2. A condition parameter outside its catalog item's declared valid range
   produces a blocking problem naming the node ID, the parameter, and the
   permitted range.
3. A field or event calendar unavailable for part of the universe produces
   a problem naming the field, the affected part of the universe, and
   whether it blocks execution or merely degrades coverage.
4. Two conditions that cannot both hold — such as disjoint ranges on the
   same field combined under `AND` — produce a problem naming the
   conflicting node IDs and explaining why nothing can satisfy both.
5. A screener whose estimated execution cost exceeds the configured budget
   produces a non-blocking warning reporting the estimate and the main
   driver of it.
6. A universe resolving to zero instruments produces a blocking problem
   reporting the empty universe and which criterion eliminated everything.
7. Disabled nodes produce no problems and are reported as skipped.
8. Validation mutates nothing: no screener field changes and the workspace
   revision does not advance.
9. Multiple independent problems are all reported in one response rather
   than only the first.
10. Tests cover the clean case, each problem class above, disabled-node
    skipping, multiple simultaneous problems, and the no-mutation
    guarantee.

## Design References

- `docs/design/screener-core/spec.md` — the "Validate a screener"
  scenario table; each AC traces to a row. Open Question 2 covers the
  cost budget.
- `docs/design/screener-core/technical.md` — the validation problem
  shape (severity, code, affected IDs, explanation).
- `backend/api/routes/research.py` — existing FastAPI route, schema, and
  error-mapping conventions for a networked tool.

## Technical Considerations

- Contradiction detection needs to be useful without being a theorem
  prover. Cover the tractable and common cases — disjoint ranges and
  mutually exclusive scalar bounds on the same field under `AND` — and
  say plainly in the response that detection is not exhaustive.
- Data-availability answers come from EPIC-1008's catalog registry.
- The cost estimate is an estimate; report it as one, with its budget, so
  the agent can decide rather than be blocked.

## Out of Scope

Executing the screener (T-1009-9), and the evaluation engine itself
(T-1009-7).
