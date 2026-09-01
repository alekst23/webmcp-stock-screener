# T-1014-9: Native alert review gate

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Open
**Depends on**: T-1014-8
**Blocks**: T-1014-11
**Issue**: —

## Description

Deliver `enable_alert` and `disable_alert`, and the human review step that
sits between them and an armed alert.

`enable_alert` does not arm anything. It records a pending activation
request that the researcher must confirm in the app's own alerts surface.
Only that confirmation arms the alert. `disable_alert` is the asymmetric
counterpart: it disarms immediately and needs no confirmation, because
disarming only ever reduces what an agent can cause.

This is the epic's sharpest safety property. An agent that can silently
arm an alert can make the app act on the world without the researcher
having agreed to it, in a way undo does not fully repair.

## User Story

As a researcher,
I want arming an alert to require me, in the app, every time,
so that no sequence of tool calls — mistaken, confused, or adversarial —
can leave something running against the market on my behalf that I never
approved.

## Acceptance Criteria

1. `enable_alert` on a draft does not arm it. It creates a pending
   activation request, and the response states explicitly that human
   confirmation in the app is required and that the alert is not armed.
2. The alerts surface shows the pending activation request with the
   alert's name, its conditions, and its preview summary, and offers an
   explicit confirm and an explicit decline.
3. Confirming in the alerts surface transitions the alert to armed, makes
   its armed state visible, and records the confirmation — who confirmed
   and when — as part of the alert's history.
4. Declining leaves the alert a draft, clears the pending request, and a
   subsequent status read reports that the activation was declined.
5. No sequence of tool calls, in any order, with any arguments,
   transitions an alert to armed without a confirmation performed in the
   app's own surface. This is covered by a test that attempts it.
6. Editing an alert's draft while an activation request is pending
   invalidates the request; arming then requires a fresh request and a
   fresh confirmation.
7. A pending activation request expires after a bounded time and must be
   re-requested; an expired request cannot be confirmed.
8. `disable_alert` disarms an armed alert immediately, without human
   confirmation, and the alert stops firing.
9. `disable_alert` on an already-disarmed alert succeeds without error
   and leaves it disarmed.
10. Every alert's state — draft, pending activation, armed, disarmed —
    its conditions, and its last firing are visible in the alerts surface
    at all times.
11. Both tools accept `expected_revision` and `idempotency_key` and
    return the common mutation envelope. A repeated `idempotency_key` on
    `enable_alert` does not create a second pending request.
12. Undoing an activation request with the returned undo token clears the
    pending request. Undo is never a path to arming an alert.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Arm and disarm an
  alert" scenario table, especially the "Agent cannot arm" and "No
  sequence arms it" rows.
- `.dev/design/tool-spec.md` — `enable_alert` and `disable_alert`, and
  the requirement to "keep alert activation behind an explicit native
  review step"; the analogous "draft → review → submit" shape the spec
  requires for anything consequential.
- `docs/plan/EPIC-1014/T-1014-8-alert-draft-and-preview.md` — the alert
  model, state machine, and preview this gate sits on.
- `docs/plan/EPIC-1007/_epic.md` — the `alerts` panel kind that hosts the
  review step.
- `docs/plan/EPIC-1006/_epic.md` — mutation envelope, revisions, undo.

## Technical Considerations

- The confirmation must originate from real user interaction in the app,
  not from anything a tool call can synthesize. The distinction between
  "a tool set a flag" and "a person clicked" is the entire feature.
- AC5 is an adversarial test, not a happy-path one. It should enumerate
  the tool surface and try to reach `armed` through it, including via
  undo, idempotent replay, and stale-revision paths.
- The asymmetry is deliberate: arming needs a human, disarming does not.
  Do not "simplify" it into a symmetric confirmation.
- Pending-request expiry and edit-invalidation both exist so a
  confirmation always refers to what the researcher actually reviewed.

## Out of Scope

- Drafting and previewing alerts (T-1014-8).
- Evaluating armed alerts against live data on a schedule, and any
  delivery channel beyond the `alerts` panel.
- Permissions or multi-user authorization models.
- Applying the same review gate to other tools — this epic adds no other
  consequential action that needs one.
