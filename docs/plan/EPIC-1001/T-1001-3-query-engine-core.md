# T-1001-3: Query engine core

**Epic**: EPIC-1001 (WebMCP Pattern Research Workbench)
**Status**: Open
**Depends on**: T-1001-1
**Blocks**: T-1001-4
**Issue**: #1

## Description

The research workflow starts with defining a derived data series and a
multi-step temporal pattern, then finding every place that pattern
occurred historically. This ticket delivers that core query capability
against the mock dataset (T-1001-1), including correct handling of
malformed formulas so a caller — human or agent — can self-correct.

## User Story

As a user (or their AI agent),
I want to define a derived series and a multi-step temporal pattern, then
search the dataset for every historical occurrence,
so that I can begin investigating a hypothesis.

## Acceptance Criteria

1. A derived series can be defined from an expression over price and
   volume data and referenced by name afterward.
2. An invalid or unsupported expression is rejected with a response that
   lists what is actually supported, rather than a generic failure.
3. A temporal pattern can be defined as an ordered sequence of conditions,
   where a later condition may be constrained to occur within a specific
   range of trading days after the previous one, and may be required to
   hold continuously across that window rather than just once.
4. Searching the dataset for a defined pattern returns every matching
   occurrence as a specific ticker and date, along with how many were
   found and over what date range.
5. Search results are verified correct against the mock dataset's
   deliberately known pattern instances (T-1001-1) — no false positives or
   false negatives on those known cases.
6. Searches can be scoped by a date range and basic universe filters (e.g.,
   minimum market cap, sector).

## Design References

- `docs/tools.md` — `defineStudy`/`defineSetup`/`findInstances` contracts
- `docs/plan.md` — engine architecture and the reasoning behind treating
  the parser and temporal matcher as the highest-risk pieces

## Technical Considerations

Correctness on edge cases (window boundaries, insufficient history near
the start or end of the dataset) matters more here than raw performance.

## Out of Scope

Measuring outcomes or splitting result sets (T-1001-4).
