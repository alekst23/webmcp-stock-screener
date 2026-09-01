# T-1013-3: Structured workspace diff and diff summary

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Open
**Depends on**: T-1013-1
**Blocks**: T-1013-5

## Description

Turn a before-state and an after-state into the diff the safety layer
reports: a machine-checkable list of typed entity changes keyed by stable
ID, and the short human-readable `diff_summary` the common mutation
contract requires. Both preview and apply report this same diff, so it is
the artifact the honesty guarantee is checked against.

## User Story

As a researcher reading what an agent is about to change,
I want a precise list of which entities are added, removed, or updated and
a one-line summary of the batch,
so that I can approve or reject the change without reading a state dump.

## Acceptance Criteria

1. Given two workspace states, the diff reports each changed entity as
   added, removed, or updated, identified by its stable ID.
2. An updated entity's diff names the changed fields with their before and
   after values, and omits fields that did not change.
3. Two identical states produce an empty diff, not a diff of unchanged
   entities.
4. Diff output is deterministic — the same pair of states always produces
   the same ordering, so results are comparable across calls.
5. The affected-ID list is the deduplicated set of stable IDs appearing in
   the diff, in first-appearance order.
6. A human-readable summary is derived from the structured diff (plus any
   summary fragments the operations contributed), and never describes a
   change the structured diff does not contain.
7. An empty diff produces a summary that says so rather than an empty
   string.
8. A summary of a large batch stays short enough to read at a glance,
   degrading to a count of remaining changes rather than growing without
   bound.
9. Diffing is a pure function of its inputs — no I/O, no clock, no state.
10. The diff traverses workspace entities generically rather than
    enumerating the entity kinds known today, so entity kinds added by
    later epics appear in diffs without changing this code.

## Design References

- `docs/design/safety-preview-apply/technical.md` — "Diff shape"
- `.dev/design/tool-spec.md` — the envelope's `diff_summary` example
  (`"Added RSI study and RSI 40–70 filter"`) and `affected_ids`
- `docs/design/safety-preview-apply/spec.md` — the honesty guarantee this
  output is measured against

## Technical Considerations

Determinism matters more than it looks: the honesty tests compare a
preview's diff to an apply's diff by equality, so any ordering that
depends on object-key iteration or insertion timing will produce
flaky-looking failures that are actually real ambiguity.

## Out of Scope

Computing the after-state (T-1013-2) and rendering the diff in any UI.
