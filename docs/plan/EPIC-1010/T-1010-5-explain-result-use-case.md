# T-1010-5: Result explanation use case (`explain_result`)

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Open
**Depends on**: T-1010-2, T-1010-3
**Blocks**: T-1010-7

## Description

Orchestrate answering "why this instrument?" for a pinned run: read the
run's stored evaluation for one instrument through the read-only contract
and assemble the full filter-by-filter explanation and ranking-contribution
breakdown. Like the results read, it must never execute a screener.

## User Story

As a researcher auditing a screener,
I want to ask about any instrument the run looked at and get every
filter's actual value and verdict plus its ranking contribution,
so that I can confirm the screener is doing what I think it is — and find
out precisely which condition eliminated a stock I expected to see.

## Acceptance Criteria

1. Given a pinned `run_id` and a stable instrument ID, an explanation is
   returned containing every leaf condition in the screener's filter tree
   with its operator, threshold, the instrument's actual value, and its
   outcome — none omitted.
2. The explanation preserves the filter tree's `AND`/`OR`/`NOT` structure
   with each group's resolved outcome, to arbitrary nesting depth.
3. Each ranking field's raw value, normalized value, weight, and
   contribution to the final score is returned, together with the
   instrument's rank in the run.
4. An instrument the run evaluated but rejected receives a full
   explanation, with its failing conditions identified and a statement
   that it is not among the run's results.
5. An instrument that was outside the run's universe produces an explicit
   error stating it was not evaluated in that run — never an empty or
   partially fabricated explanation.
6. A condition whose input datum was unavailable for that instrument is
   reported as indeterminate with its reason, distinct from a fail.
7. **No screener is executed.** A test using a run store whose execution
   path fails the test if reached demonstrates that an explanation read
   never reaches it — for a passing instrument, a rejected instrument, and
   an expired run.
8. An unknown or expired `run_id` produces an explicit error naming the
   `run_id` and stating the screener must be run again.
9. The explanation names the pinned `run_id` and screener revision it was
   derived from, and carries the same provenance a results page carries.
10. The use case reads only — it makes no workspace mutation and returns
    no mutation envelope.
11. An explanation is bounded: a filter tree or ranking configuration
    large enough to exceed the response bound is truncated with an
    explicit marker naming what was omitted, rather than silently dropped
    or returned unbounded.

## Design References

- `docs/design/results-and-explain/spec.md` — "Explain a result"
  scenarios in full.
- `docs/plan/EPIC-1010/T-1010-3-explanation-domain-model.md` — the
  explanation model this assembles.
- `docs/plan/EPIC-1010/T-1010-2-results-page-and-pinned-run-contract.md` —
  the read contract and provenance record this consumes.

## Technical Considerations

- Whether EPIC-1009 stores per-instrument condition evaluations with the
  run, or only the final verdict, determines whether this use case reads
  them or must recompute them from the run's captured inputs. Recomputing
  from the run's own captured data is acceptable; re-running the screener
  is not. Confirm against EPIC-1009's run contract before implementing and
  record the answer in the epic's open questions if it differs from the
  assumption.
- AC7's test is the guarantee, not the comment — it must fail if the
  implementation falls back to a rerun.

## Out of Scope

- Producing evaluations during a run (EPIC-1009).
- Rendering the explanation (T-1010-7).
- Tool registration (T-1010-8).
