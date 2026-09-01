# T-1014-8: Alert draft and preview

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Open
**Depends on**: — (consumes EPIC-1007's `alerts` panel kind and
EPIC-1009's screener/filter model)
**Blocks**: T-1014-9
**Issue**: —

## Description

Deliver `create_alert_draft` and `preview_alert` — everything an agent is
allowed to do with an alert. A draft describes what would fire and on
what conditions; a preview shows what it would have fired on over a
recent historical window, and how noisy it would be. Neither arms
anything.

The draft state is deliberately terminal from the agent's side: T-1014-9
adds the human review gate that is the only path from draft to armed.
This ticket establishes the alert model, the state machine, and the
guarantee that a newly created alert is inert.

## User Story

As a researcher whose agent has found a condition worth watching,
I want it drafted and previewed so I can see what it would have caught
and how often it would interrupt me,
so that I decide what gets to page me — and can tell before deciding.

## Acceptance Criteria

1. `create_alert_draft` accepts a name and either a screener revision or
   a set of typed conditions, and creates an alert with a stable ID in a
   **draft** state.
2. A newly created draft is inert: it evaluates nothing, fires nothing,
   and emits no notification of any kind.
3. The draft is visible in the alerts surface immediately, showing its
   name, its conditions, and its state as not armed.
4. `preview_alert` accepts an alert ID and a historical window and
   reports what the alert would have fired on: the firing count, the
   firing rate, and the instruments and dates involved.
5. Previewing does not change the alert's state and emits no
   notification.
6. A preview whose firing rate exceeds the configured practicality
   threshold returns a warning that the alert appears too noisy, stating
   the observed rate.
7. A preview with no historical firings reports zero firings plainly, not
   an error.
8. A draft referencing unavailable data or containing contradictory
   conditions is reported as not previewable, naming the specific
   problem, and is marked as such until fixed.
9. A draft's conditions can be edited, and editing keeps it a draft.
10. The alert state machine defines exactly these states — draft, pending
    activation, armed, disarmed — and permits no transition into `armed`
    from any tool call in this ticket.
11. `create_alert_draft` accepts `expected_revision` and
    `idempotency_key` and returns the common mutation envelope; a
    repeated `idempotency_key` does not create a second draft. Undoing
    with the returned undo token removes the draft.
12. `preview_alert` is read-only and mutates no workspace state.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Draft and preview an
  alert" scenario table, and the state list in "Arm and disarm an alert".
- `.dev/design/tool-spec.md` — `create_alert_draft` and `preview_alert`;
  the requirement to "keep alert activation behind an explicit native
  review step"; the `alerts` panel kind in `add_panel`.
- `docs/plan/EPIC-1007/_epic.md` — the `alerts` panel kind this binds to.
- `docs/plan/EPIC-1009/_epic.md` — the typed condition model an alert's
  conditions are expressed in, and `validate_screener`'s
  contradictory-filter and unavailable-data detection, which the
  not-previewable check parallels.
- `docs/plan/EPIC-1006/_epic.md` — mutation envelope, revisions, undo.

## Technical Considerations

- The state machine is the security boundary. Model it explicitly, with
  the `armed` transition unreachable from this ticket's code, rather than
  relying on callers to behave.
- A preview is a bounded historical evaluation, closely related to the
  backtest engine's frequency statistic. Reuse rather than duplicate
  where the shapes genuinely match, but a preview is a cheap recent-window
  read, not a full backtest.
- Noise thresholds should be configurable constants with stated defaults.
- An alert bound to a screener revision needs defined behavior when that
  revision is superseded — the pending-activation invalidation rule in
  T-1014-9 depends on this being explicit.

## Out of Scope

- Arming, disarming, and the human review gate (T-1014-9).
- Alert delivery channels beyond visibility in the `alerts` panel.
- Actually evaluating armed alerts against live data on a schedule.
- The `alerts` panel kind and its rendering (EPIC-1007).
