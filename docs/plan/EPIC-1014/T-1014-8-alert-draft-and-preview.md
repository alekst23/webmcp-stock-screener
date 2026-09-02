# T-1014-8: Alert draft and preview

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Done
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
- `docs/reference/tool-spec.md` — `create_alert_draft` and `preview_alert`;
  the requirement to "keep alert activation behind an explicit native
  review step"; the `alerts` panel kind in `create_panel`.
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

## Solution Approach

New directory `src/lib/workbench/alerts/` (domain/, application/, infra/, tools/),
following the same layering `chart/` and `similarity/` already use, wired through
EPIC-1006's `operationRegistry` / `RevisionService` / `ChangeHistory` for the one
mutating tool and left out of the mutation machinery entirely for the read-only one.

### State machine (the security boundary)

`domain/alertStateMachine.ts`:
- `AlertState = 'draft' | 'pending_activation' | 'armed' | 'disarmed'` — the exact
  four states AC10 requires, asserted by a test that reads `ALERT_STATES`.
- `ALERT_STATE_TRANSITIONS`: a **data-only** documentation graph of every legal
  transition in the whole feature (including the ones T-1014-9 implements, e.g.
  `pending_activation -> armed`), so T-1014-9's author has one place to extend
  instead of inventing the graph. Data describing legality is not itself a
  transition-performing code path.
- `INITIAL_ALERT_STATE = 'draft'` and `isDraft(state)` are the **only** executable
  exports. There is no `transition(from, to)` function, no `arm`/`confirmActivation`
  export, nothing that takes a target state as a parameter. A test pins
  `Object.keys(alertStateMachine)` to a fixed list so an accidental new export (e.g.
  a generic transitioner a future edit could call with `'armed'`) fails CI.
- Every write path in this ticket (create, edit) can only ever set state to
  `'draft'` — enforced by construction (the field is hard-coded, never taken from
  wire input) and covered by a dedicated test that feeds adversarial input (a wire
  payload that literally sets `state: "armed"`) and asserts the stored record is
  still `'draft'`.

### Alert record & storage

`domain/alert.ts`, mirroring `chart/domain/capturedSetup.ts`'s self-contained-record
pattern and `screener/state.ts`'s extension-key storage:
- `AlertConditionSource` = `{ kind: 'screener_revision'; screenerId; screenerRevision;
  filterTree; universe }` (a **frozen snapshot** taken at draft-creation/edit time,
  not a live reference — matches `CapturedChartSetup`'s "reconfiguring the source
  never changes the record" property) `| { kind: 'conditions'; conditions: Condition[] }`
  (EPIC-1009's typed `Condition` model, reused verbatim, ANDed together).
- `AlertRecord { alertId, workspaceId, name, state, source, previewable,
  previewProblems, createdAt, updatedAt }`.
- Stored at `doc.extensions.alerts[alertId]`, normalized on read (never throws),
  `toWireAlert` serializer, `alertIdSeed` for the `IdSequencer` high-water mark.
- `isScreenerSourceSuperseded(source, doc)`: compares the frozen `screenerRevision`
  against the *live* screener's current revision, when it still exists. Informational
  only in this ticket (surfaced as a warning on read/preview) — T-1014-9's
  pending-activation invalidation rule is the consumer of this fact, per the
  ticket's Technical Considerations; this ticket makes the fact available and
  explicit without acting on it.

### Not-previewable check (AC8) — reuse, not reinvention

`domain/alertConditions.ts` builds a throwaway `ScreenerDefinition`-shaped object from
either source kind (for `conditions`, an ephemeral synthetic AND-group) and hands it to
EPIC-1009's existing `validateScreenerDefinition` (screener/screenerValidation.ts),
exactly as the design references direct: "the not-previewable check parallels
validate_screener's contradictory-filter and unavailable-data detection." No
contradiction/availability logic is reimplemented. `previewable = report.valid`;
`previewProblems` = the messages of the `severity: 'blocking'` problems only (advisory
problems like the cost-budget warning never gate previewability).

Because `validateScreenerDefinition` is `async`, this check runs in an async
"prepare" phase before the mutation is applied — the same two-phase shape
`chart/application/captureSetup.ts`'s `prepareCapture` already uses to keep
`OperationDefinition.apply()` synchronous. `validate()` on both operations re-derives
the same structural issues synchronously (unknown screener id, malformed conditions)
so a caller reaching the registry directly is still protected.

### Preview evaluator (AC4-7) — self-contained, not the backtest engine

`domain/alertPreview.ts`:
- `AlertHistoricalDataPort` — the seam: `resolveUniverse(universe)` and
  `evaluate({ instrumentIds, filterTree, window })  ->  { firings, evaluatedDays,
  warnings }`. Deliberately narrow (values in, values out), matching
  `screener/ports.ts`'s `ScreenerMarketData` convention — infra's problem is *how*
  to evaluate a filter tree over history; this ticket's problem is what a preview
  *reports* once it has that.
- `summarizePreview(...)` — pure aggregation: firing count, unique instruments,
  unique dates, `firingRate = firingCount / evaluatedDays` (fires per evaluated
  trading day — directly "how often would this interrupt me"), `noisy = firingRate >
  DEFAULT_ALERT_NOISE_THRESHOLD` (default **1** fire/day, a configurable constant).
  Zero firings is a normal report (AC7), never an error.
- Default composition wires an honest empty `InMemoryAlertHistoricalDataPort`
  (`infra/inMemoryAlertHistoricalData.ts`) — mirrors chart's `defaultSeriesPort`:
  a real implementation with no data behind it, so it truthfully reports zero
  firings rather than fabricating any, matching AC7's "zero firings, not an error"
  as the honest default. Tests inject a fixture-backed instance with real firing
  data to exercise the noisy/never-fires/mixed scenarios end to end. Building the
  live historical evaluation pipeline is out of scope (T-1014-5 territory, not
  available this wave per the ticket's own note) — this ticket ships the contract
  and a safe default, not a market-data backtest.

### Tools

- `create_alert_draft` (mutating): operation kind `alerts.create_draft`. Accepts
  `name` + exactly one of `screener_id` / `conditions`, `expected_revision`,
  `idempotency_key`. Returns the mutation envelope plus the created alert
  (state `draft`, `previewable`, `preview_problems`). Undo removes the draft.
- `edit_alert_draft` (mutating, new — AC9 requires editing but names no separate
  tool in tool-spec.md; `upsert_watchlist` is this project's precedent for one tool
  serving create-or-update, but alerts' tool-spec only lists `create_alert_draft`
  for creation, so this ships as its own small tool named after `edit_filter_tree`'s
  convention). Operation kind `alerts.edit_conditions`. Takes `alert_id` plus any of
  `name` / `screener_id` / `conditions`; refuses to edit anything not in `draft`
  state (dead code today — nothing in this ticket produces another state — but
  guards the invariant defensively and gives T-1014-9 an existing guard to build
  the "editing invalidates a pending request" rule against instead of adding the
  check from scratch).
- `preview_alert` (read-only, no operation/mutation, modeled on `get_chart_data`):
  rejects `expected_revision` outright (nothing to guard). Reads the stored
  `previewable`/`previewProblems` off the record (never recomputes — recomputing on
  a read would itself be pointless work and risks a read silently disagreeing with
  the stored mark) and short-circuits with the named problems when false. Otherwise
  resolves instruments, calls the port, aggregates, and returns the report. Never
  calls `applyOperations`, never touches `ChangeHistory` — AC12.

`tools/registerAlertTools.ts` is gated behind `ALERT_TOOLS_ENABLED = false`, matching
`registerChartTools.ts` — the follow-up tool surface is wired on by T-1014-11.

### Safety verification (explicit, per the ticket's stop condition)

A dedicated test file asserts, by direct inspection of `alertStateMachine.ts`'s
exports and by exercising `create_alert_draft` / `edit_alert_draft` with adversarial
`state: "armed"` wire input, that no code path in this ticket can produce a stored
`AlertRecord` whose `state` is anything but `'draft'`.

## Out of Scope

- Arming, disarming, and the human review gate (T-1014-9).
- Alert delivery channels beyond visibility in the `alerts` panel.
- Actually evaluating armed alerts against live data on a schedule.
- The `alerts` panel kind and its rendering (EPIC-1007).
