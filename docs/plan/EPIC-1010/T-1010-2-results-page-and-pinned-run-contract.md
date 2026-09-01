# T-1010-2: Bounded results page, provenance envelope, and pinned-run read contract

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Open
**Depends on**: —
**Blocks**: T-1010-4, T-1010-5

## Description

Define what a page of screener results *is* — the row shape, the bounded
paging model, the market-data provenance every value carries — and the
read-only contract by which a pinned run's results are obtained. This
contract is the structural guarantee behind the epic's core promise: it
offers no way to execute a screener, so a read cannot rerun one.

## User Story

As an agent reading a screener's output,
I want a page of results whose every value states where it came from and
when,
so that I can reason about the numbers without guessing whether they are
live, delayed, adjusted, or stale.

## Acceptance Criteria

1. A results page expresses: the rows on the page, the total number of
   results in the run, the page's position, and a cursor for the next page
   (absent when the page is the last).
2. Each row is identified by a stable result ID and carries a stable
   instrument ID; the ticker is present as a display attribute only and is
   never used as an identifier.
3. A provenance record accompanies every page and states `as_of`, source,
   live/delayed status, timezone, currency, whether prices are adjusted or
   unadjusted, the fundamentals reporting period, and the
   calculation-engine version.
4. The `as_of` a page reports is the pinned run's own timestamp, not the
   time the page was read.
5. The read contract exposes operations to obtain a run's metadata and a
   slice of its results, and exposes no operation that executes,
   re-executes, or refreshes a screener.
6. Requesting results for a `run_id` that is unknown or expired produces a
   distinct, typed not-available outcome that names the `run_id` and states
   that the screener must be run again — it never falls back to executing
   the screener and never returns an empty page as if the run were empty.
7. A run that matched nothing yields an empty page with a total of zero
   and full provenance — distinguishable from the not-available outcome in
   AC6.
8. Paging over a result set with ties in the sort key is stable: across a
   full traversal every row appears exactly once and none is skipped.
9. The page model enforces its own bound: it cannot represent a page
   larger than the documented hard maximum, and a request above that
   maximum is rejected naming the maximum rather than clamped.
10. A test double implementing the read contract is available for the
    Wave 2 use-case tickets, so they do not depend on EPIC-1009's run
    execution being finished.

## Design References

- `docs/design/results-and-explain/spec.md` — "Read a bounded page of
  results" scenarios, including "No silent rerun", "Expired or unknown
  run", and "Provenance".
- `docs/reference/tool-spec.md` — the `get_screener_results` row and the
  market-data provenance paragraph in the common contract.
- `backend/domain/contracts/engine.py` — the existing Protocol-based
  contract style for engine boundaries.

## Technical Considerations

- The pinned `run_id` and the stored run come from EPIC-1009. Define the
  read contract here as a port; EPIC-1009's store implements it. Do not
  implement run execution or storage in this ticket.
- The "no silent rerun" guarantee should be structural rather than
  policed by a comment — a contract with no execute operation cannot rerun
  by accident.
- Provenance is EPIC-1006's shared type if it exists by the time this
  starts; consume it rather than declaring a parallel one.

## Out of Scope

- Executing or storing screener runs (EPIC-1009).
- Projecting rows through a table configuration and applying computed
  columns (T-1010-4).
- The explanation model (T-1010-3).
