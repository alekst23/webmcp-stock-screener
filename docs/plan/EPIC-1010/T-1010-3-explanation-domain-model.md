# T-1010-3: Filter explanation and ranking contribution domain model

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Open
**Depends on**: —
**Blocks**: T-1010-5

## Description

Define the typed model that makes a screener's verdict auditable for one
instrument: an evaluation record for every condition in the filter tree —
its threshold, the instrument's actual value, and its outcome — mirroring
the tree's `AND`/`OR`/`NOT` structure, plus a breakdown of how each
ranking field contributed to the instrument's score. Pure domain logic
with no I/O.

## User Story

As a researcher asking "why did the screener pick this one, and why not
that one?",
I want every filter's actual value and pass/fail state and every ranking
field's contribution,
so that the screener's answer is something I can check rather than
something I have to trust.

## Acceptance Criteria

1. An explanation is addressed by a stable instrument ID and names the
   pinned run and screener revision it was derived from.
2. Every leaf condition in the screener's filter tree appears in the
   explanation with: its stable condition ID, a human-readable
   restatement, its operator, its threshold or comparison operand, the
   instrument's actual value with unit, and an outcome.
3. The explanation preserves the filter tree's structure: `AND`, `OR`, and
   `NOT` groups appear as groups, each with its own resolved outcome, and
   nested groups are represented to arbitrary depth.
4. A condition outcome is one of pass, fail, or indeterminate;
   indeterminate carries a reason (such as a missing input datum) and is
   never conflated with a fail.
5. A group's outcome follows from its children's outcomes under the
   group's operator, and the model defines how an indeterminate child
   resolves at the group level.
6. Disabled conditions appear in the explanation marked as not
   contributing to the outcome, rather than being omitted.
7. Each ranking field appears with its raw value, its normalized value,
   its configured weight and direction, and its contribution to the final
   score; the contributions and the reported final score are consistent
   with each other.
8. The explanation states the instrument's rank within the run and whether
   the instrument is among the run's results or was evaluated and
   rejected.
9. Every value in the explanation carries the same provenance record a
   results page carries.
10. The model is a pure representation with no I/O and no dependency on
    how the evaluation was produced.

## Design References

- `docs/design/results-and-explain/spec.md` — "Explain a result"
  scenarios, including "Failed candidate" and "Unavailable data"; Open
  Questions 5 and 6.
- `.dev/design/tool-spec.md` — the `explain_result` row, the
  `edit_filter_tree` condition types (scalar, range, series comparison,
  temporal, event-relative, pattern, relative, study output) that
  explanations must be able to restate, and the ranking configuration
  described under `set_screener_ranking`.

## Technical Considerations

- The filter tree and ranking configuration are EPIC-1009's types.
  Consume them; do not redefine them. If they are not yet available,
  code against the shape the design doc describes and adapt.
- All eight condition types in the design doc must be representable — a
  temporal condition ("crossed above within the last five bars") needs to
  report which bar it occurred on, not just a scalar comparison.
- Contribution arithmetic being self-consistent (AC7) is worth a
  property-style test, not just an example.

## Out of Scope

- Retrieving an evaluation from a stored run (T-1010-5).
- Rendering the explanation (T-1010-7).
- Producing the evaluation during a run (EPIC-1009).
