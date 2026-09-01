# T-1010-6: Table configuration and selection mutations (`configure_results_table`, `select_result`)

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Open
**Depends on**: T-1010-1
**Blocks**: T-1010-7

## Description

The two write operations of the Results area: applying a validated
results-table configuration to a panel, and setting a panel's selected
results so linked chart and details panels follow. Both go through
EPIC-1006's workspace revision pipeline and return its mutation envelope.

## User Story

As an agent shaping a research view,
I want to change how results are presented and pick out the rows worth
looking at,
so that the person I am working with sees the columns that matter and the
chart follows what I selected — with every change revisioned and
undoable.

## Acceptance Criteria

1. Applying a results-table configuration to a panel updates the panel's
   configuration and returns the common mutation envelope: `change_id`,
   `new_revision`, `affected_ids`, `diff_summary`, `warnings`,
   `undo_token`.
2. `diff_summary` states in plain language what changed (for example,
   which columns were added or removed and how the sort changed), rather
   than restating the whole configuration.
3. A configuration that fails validation is rejected with the validation
   messages and applies nothing — the panel and the workspace revision are
   unchanged.
4. Validation warnings (such as a sort key that is not a visible column)
   are returned in the envelope's `warnings` while the mutation still
   applies.
5. Setting a selection replaces the panel's selected result IDs and
   returns the mutation envelope; selecting an empty set clears the
   selection.
6. A result ID that is not part of the run the panel is showing is
   rejected, naming the unknown ID, and the previous selection is
   unchanged.
7. When the panel is linked to a chart or details panel, the selection is
   propagated so those panels show the selected instrument; when several
   results are selected and the linked target can show only one, the
   primary (first) selection propagates and a warning states the rest did
   not.
8. Both mutations accept `expected_revision`; a caller whose
   `expected_revision` is behind the workspace's current revision is
   rejected as a revision conflict with nothing applied.
9. Both mutations accept `idempotency_key`; replaying a key returns the
   original result and leaves the workspace mutated exactly once, verified
   by a test that would fail on a duplicate write.
10. The `undo_token` returned by either mutation reverses it, restoring the
    previous configuration or selection.
11. A selection made by the person directly in the UI is readable by the
    agent, and an agent selection replaces it wholesale rather than
    merging into it silently.
12. Neither mutation executes a screener.

## Design References

- `docs/design/results-and-explain/spec.md` — "Configure the results
  table" and "Select results" scenarios.
- `docs/plan/EPIC-1010/T-1010-1-results-table-config-model.md` — the
  configuration model and its validation.
- `.dev/design/tool-spec.md` — the common mutation contract and its
  envelope shape.

## Technical Considerations

- The revision model, envelope, idempotency handling, and undo tokens are
  EPIC-1006's. Consume them; do not build a parallel mechanism. If
  EPIC-1006 has not landed when this starts, code against its contract
  and use a test double.
- Panel linking itself is EPIC-1007's `link_panels`. This ticket only
  propagates along links that already exist.
- AC9's idempotency test must be able to detect a duplicate write — assert
  on the resulting state and revision count, not merely on the returned
  value.

## Out of Scope

- The workspace revision model, envelope, and undo mechanics (EPIC-1006).
- Establishing links between panels (EPIC-1007).
- Reading results or explanations (T-1010-4, T-1010-5).
- Rendering (T-1010-7).
