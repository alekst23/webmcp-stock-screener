# T-1014-9: Native alert review gate

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Done
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

## Solution Approach

**Model extension (`alerts/domain/`).** `AlertRecord` (T-1014-8) gains two
fields: `pendingActivation: AlertActivationRequest | null` and
`activationHistory: AlertActivationEvent[]`. A new file,
`domain/alertActivation.ts`, defines these types plus pure helpers
(`computeActivationExpiry`, `isActivationRequestExpired`,
`appendActivationEvent`) and the 15-minute `PENDING_ACTIVATION_TTL_MS`
bound (AC7). `domain/alertStateMachine.ts` gains three read-only
predicates -- `isPendingActivation`, `isArmed`, `isDisarmed` -- alongside
the existing `isDraft`; each takes a known state and returns a boolean,
matching the module's existing "no transition-performing export" guarantee
(its pinned export-surface test is extended, not relaxed). `toWireAlert`
is fixed to report `armed: alert.state === 'armed'` (previously hard-coded
`false`, correct only because T-1014-8 never produced anything else) and
now serializes `pending_activation` and `activation_history`.

**Tool-reachable half (`alerts/application/enableAlert.ts` +
`disableAlert.ts`, wired via `alerts/tools/enableAlert.ts` +
`disableAlert.ts`).** Two new `OperationDefinition`s, following T-1014-8's
create/edit shape exactly:
- `alerts.enable_activation`: `draft -> pending_activation` only. `apply()`
  hard-codes the target state (never reads one from input); refuses a
  second request while an existing one is still pending and unexpired
  (re-requesting after expiry is allowed, recording an `'expired'` event
  first). Its inverse restores the pre-request document -- safe, because
  that document is never `'armed'` (AC12).
- `alerts.disable_activation`: `armed -> disarmed`, and a true no-op when
  already `disarmed` (AC9). **Its `MutationDraft.inverse` is unconditionally
  `null` on every path.** This is the single most load-bearing line in the
  ticket: the shared undo machinery (`changeHistory.ts`) lets an agent undo
  an undo, which *redoes* the original change -- so a normal inverse here
  would hand an agent a tool-only path back to `armed` via two
  `undo_change` calls. `inverse: null` means there is no undo token for
  `disable_alert` at all, closing that path structurally rather than by
  convention. Verified by a mutation check (temporarily restoring a real
  inverse) that fails `disableAlert.test.ts`, `disableAlert.test.ts` (tools),
  and `alertActivationSafety.test.ts` in three places.

**Edit invalidation (AC6, extends T-1014-8's `editAlertDraft.ts`).**
`findEditableAlert`'s guard now accepts `'pending_activation'` alongside
`'draft'` (previously only `'draft'`). When the edited alert was pending,
`applyEditAlertDraft` clears `pendingActivation`, appends an
`'invalidated'` activation-history event, and its `diffSummary` says so;
the target state stays hard-coded to `'draft'` exactly as before. `'armed'`
and `'disarmed'` remain refused.

**Human-only half (`alerts/application/confirmAlertActivation.ts` +
`declineAlertActivation.ts`).** Plain functions -- not
`OperationDefinition`s, not registered in the shared `OperationRegistry`,
not built into any `ToolSpec`, and never imported by anything under
`alerts/tools/`. `confirmAlertActivation` is the only code in the program
that writes `state: 'armed'`. Both bypass `recordCommit`/`ChangeHistory`
entirely -- calling `RevisionService.commit` directly with `inverse: null`
-- so a confirm or decline never creates a `ChangeHistory` entry and so
never has a redeemable `undo_change` token. This is what makes the
redo-based attack above impossible for confirm as well: there is no
undo-of-undo to chain through if there was never an undo to begin with.
Both are dependency-shape-pinned (`Object.keys(deps)` has no `history`
field) so the absence is structural, not just a choice this call site
happened to make. `confirmAlertActivation` also checks
`isActivationRequestExpired` and refuses to confirm an expired request
(AC7); the alert stays `'pending_activation'` until re-requested.

**Wiring (`alerts/tools/index.ts`).** `enable_alert` and `disable_alert`
join the three T-1014-8 tools (five total, four operation kinds). No sixth
tool exists for confirm/decline -- that absence is itself part of the
contract and is asserted by a dedicated test.

**Testing.** Each new/changed production file has a co-located unit-test
file plus explicit mutation checks (temporarily reverting the fix,
confirming the test goes red, then reverting back) for every
safety-relevant branch. `alerts/tools/alertActivationSafety.test.ts` is
AC5's dedicated adversarial suite -- see the "How AC5 is proven" note in
this ticket's final report for what it covers.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Arm and disarm an
  alert" scenario table, especially the "Agent cannot arm" and "No
  sequence arms it" rows.
- `docs/reference/tool-spec.md` — `enable_alert` and `disable_alert`, and
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
