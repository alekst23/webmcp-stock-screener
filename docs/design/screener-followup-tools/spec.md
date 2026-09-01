# Screener Follow-Up Tools — Product Spec

## Intent

The core screener surface lets a researcher and their agent build a
screen, run it, read the results, chart a name, and search for
lookalikes. That is a good single session. It is not durable research:
nothing carries forward, nothing is validated against history, nothing
leaves the browser, and nothing watches the market after the tab closes.

This feature adds the follow-up capabilities that close that gap —
refining a similarity search from feedback, authoring reusable computed
fields and studies, turning an example chart into a starting filter tree,
backtesting a screen against history, saving results into watchlists,
setting up alerts, and exporting a run with enough provenance that
someone can reproduce it later.

Two properties matter as much as the capabilities themselves. First, the
agent gains authoring power without gaining code execution: fields and
studies are built from a typed, validated vocabulary, never from a
free-form string the app evaluates. Second, the agent can prepare an
alert but can never arm one — that step belongs to the human, in the
app's own surface.

Done looks like: an agent proposes a refined screen, backs it with a
backtest that is honest about survivorship, saves the survivors to a
watchlist, drafts an alert the researcher reviews and arms by hand, and
hands over an export that states exactly what data it was built from and
when.

## Preconditions

- A workspace exists with the common mutation contract in force
  (revisions, `expected_revision`, `idempotency_key`, undo tokens).
- The catalog registry is available, listing the fields, functions,
  units, and ranges that authoring is permitted to draw from.
- A screener with a filter tree, a universe, and pinned runs exists.
- Captured chart setups and the similarity feature model exist.
- Panel kinds `watchlist` and `alerts` are registered and renderable.

## Features

1. **Refine a similarity search**: adjust feature weights from the
   matches a researcher accepted and rejected, and re-search.
2. **Derive filters from a setup**: turn a captured example chart into an
   editable draft filter tree.
3. **Author a computed field**: define a validated formula over permitted
   fields and functions, usable as a screener column or filter operand.
4. **Author a custom study**: define a reusable study through a typed
   expression model, usable on charts and in filters.
5. **Backtest a screener**: evaluate historical frequency, forward
   returns, and drawdowns under an explicit survivorship assumption.
6. **Read backtest results**: retrieve a completed backtest by ID without
   re-running it.
7. **Maintain watchlists**: create or update a static or dynamic
   watchlist, and save a pinned run's results into one.
8. **Draft and preview an alert**: describe an alert's conditions and see
   what it would have fired on, without arming it.
9. **Arm and disarm an alert**: activate an alert only through an
   explicit human review step, and disable an armed one.
10. **Export results**: emit a pinned run's rows, filters, timestamp, and
    provenance in a portable form.

## Behavioral Specifications

### Refine a similarity search

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a similarity search with results the researcher has marked accepted and rejected | refinement is requested | feature weights are adjusted to favor the accepted matches' features over the rejected ones, a new search runs, and the response reports which weights moved and by how much |
| Explainable | a refinement has been applied | the refined weights are inspected | every changed weight names its feature and its before/after value, so the change is auditable rather than opaque |
| No feedback | a similarity search with no accepted and no rejected matches | refinement is requested | the call is rejected with an explanation that feedback is required; no weights change and no search runs |
| Only rejections | matches marked rejected but none accepted | refinement is requested | weights move away from the rejected matches' distinguishing features, and a warning states the refinement is one-sided |
| Contradictory feedback | the same match marked both accepted and rejected | refinement is requested | the call is rejected naming the conflicting match; nothing changes |
| Reversible | a refinement has been applied | the returned undo token is used | the previous weights are restored exactly |

### Derive filters from a setup

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a captured chart setup | filters are derived from it | a **draft** filter tree is returned with a stable draft ID, containing typed conditions traceable to the setup's observed characteristics |
| Draft is not live | a derived draft filter tree | the screener is inspected | the live screener's filter tree is unchanged — the draft is not applied |
| Editable | a derived draft filter tree | a condition in it is edited, removed, or disabled | the draft updates and remains a draft |
| Accepted | a derived draft filter tree | it is explicitly accepted onto a screener | the screener's filter tree becomes the draft's contents, as one reversible change |
| Explained | a derived draft filter tree | it is inspected | each condition states which characteristic of the setup produced it, so the researcher can judge and prune it |
| Unavailable inputs | a setup referencing a field or study with no data for the target universe | filters are derived | the affected conditions are omitted or disabled, and a warning names each one and why |
| Nothing derivable | a setup with no characteristics that map to any supported condition type | filters are derived | an empty draft is returned with a warning explaining that nothing could be derived; no error is raised |

### Author a computed field

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a formula built from permitted fields, operators, and functions | the field is created | a validated computed field with a stable ID is created, and it can be used as a results column, a ranking input, and a filter operand |
| Unknown identifier | a formula referencing a field or function not in the catalog | the field is created | creation is rejected, the offending identifier is named, and permitted alternatives are offered so the agent can self-correct in one turn |
| Type or unit mismatch | a formula combining incompatible types or units (a date minus a currency, say) | the field is created | creation is rejected explaining the mismatch; no field is created |
| No code execution | a formula supplied as a SQL string, a JavaScript expression, or any free-form executable text | the field is created | creation is rejected; the app never evaluates the text |
| Division and edge cases | a formula that can divide by zero or reference missing data | the field is used in a run | the field yields an explicit "not available" for the affected rows rather than failing the run, and the run's warnings note it |
| Named and stable | a computed field | it is referenced later | it is addressed by its stable ID, not by its display name or position |
| Reversible | a computed field has been created | the returned undo token is used | the field is removed and any column or filter referencing it is restored to its prior state |

### Author a custom study

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a typed expression over permitted series and functions, with declared parameters and defaults | the study is created | a reusable study with a stable ID is created, addable to charts and usable in study-output filter conditions |
| Declared surface | a created custom study | it is inspected in the catalog | its parameters, valid ranges, defaults, outputs, and units are described the same way built-in studies are |
| No code execution | a study body supplied as JavaScript or any free-form executable text | the study is created | creation is rejected; the app never evaluates the text |
| Invalid vocabulary | a study referencing an unknown function, series, or an out-of-range parameter default | the study is created | creation is rejected naming the problem and the permitted vocabulary |
| Bounded cost | a study whose evaluation would exceed the engine's cost limits (an unbounded lookback, say) | the study is created | creation is rejected or the study is created with a warning stating the bound applied |
| Reversible | a custom study has been created | the returned undo token is used | the study is removed and any chart or filter referencing it is restored to its prior state |

### Backtest a screener

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a screener revision, a historical date range, and forward-return horizons | a backtest is requested | a stable backtest ID is returned immediately and the backtest proceeds against the specified revision |
| Pinned to a revision | a backtest was started against a screener revision | the screener is edited afterward | the backtest's results still describe the revision it was started against, and say which revision that was |
| Survivorship is explicit | any completed backtest | its results are read | the survivorship assumption is stated in plain terms — whether delisted and merged instruments were included, and what that does to the numbers |
| Lookahead | a screener whose filters reference data not knowable at the historical decision date | a backtest is requested | the affected conditions are rejected or evaluated on a lag, and the results warn that a lookahead risk was found and how it was handled |
| Insufficient history | a date range or universe with too little history to support the requested horizons | a backtest is requested | the backtest is rejected or truncated with a warning naming the actual coverage |
| Empty result | a screener that matched nothing in the historical range | a backtest completes | the results report zero matches with the range and universe stated, rather than an error |

### Read backtest results

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a completed backtest ID | results are requested | historical match frequency over time, forward-return distributions per horizon, and drawdown statistics are returned, alongside the universe, date range, survivorship assumption, and calculation-engine version |
| No silent rerun | a completed backtest ID | results are requested repeatedly | the same stored results are returned each time; the backtest is never re-executed implicitly |
| Still running | a backtest that has not finished | results are requested | an in-progress status with progress information is returned, not partial results presented as final |
| Failed | a backtest that failed | results are requested | a failed status with the reason is returned |
| Unknown ID | a backtest ID that does not exist | results are requested | the call is rejected saying so; nothing is executed |
| Bounded reads | a backtest with a very large match set | results are requested | reads are paginated and bounded, addressed by stable IDs |

### Maintain watchlists

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Create static | a name and a set of instruments | a watchlist is created | a static watchlist with a stable ID holds exactly those instruments |
| Create dynamic | a name and a screener revision | a dynamic watchlist is created | the watchlist is defined by the screener rather than a fixed member list, and states which revision defines it |
| Update | an existing watchlist ID | it is updated with a new name or membership | the existing watchlist is modified in place and keeps its ID; a second identical update does not duplicate it |
| Save a run | a pinned run ID and a target watchlist | the run's results are saved to it | the run's instruments are added, and the watchlist records the source run ID and the run's timestamp as provenance |
| Save without rerunning | a pinned run ID | its results are saved to a watchlist | the screener is not re-executed; the saved membership matches the pinned run exactly |
| Save a selection | a pinned run and a selected subset of its results | the selection is saved | only the selected instruments are added |
| Duplicates | a watchlist already containing some of the instruments being added | the save proceeds | membership is deduplicated by instrument ID and the response reports how many were already present |
| Visible | a watchlist exists | the workspace is inspected | it can be bound to a watchlist panel and seen by the researcher |
| Reversible | a watchlist create, update, or save | the returned undo token is used | the prior watchlist state is restored exactly |

### Draft and preview an alert

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a screener revision or a set of typed conditions, plus a name | an alert draft is created | a draft alert with a stable ID is created in a **draft** state, visible in the alerts surface as not armed |
| Preview | an alert draft | it is previewed | the preview reports what the alert would have fired on over a recent historical window, how often, and on which instruments — without arming it |
| Preview is read-only | an alert draft | it is previewed | the draft's state is unchanged and no notification of any kind is emitted |
| Noisy alert | a draft whose preview shows an impractically high firing rate | it is previewed | the preview warns that the alert appears too noisy, with the observed rate |
| Never fires | a draft whose preview shows no historical firings | it is previewed | the preview reports zero firings plainly, rather than an error |
| Invalid draft | a draft referencing unavailable data or contradictory conditions | it is created or previewed | the problem is named and the draft is marked not previewable until fixed |
| Reversible | an alert draft was created | the returned undo token is used | the draft is removed |

### Arm and disarm an alert

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Agent cannot arm | an alert draft | an agent requests activation | the alert is **not** armed; the request is recorded as a pending activation the researcher must confirm in the app, and the response says so explicitly |
| Human arms | a pending activation request | the researcher confirms it in the app's alerts surface | the alert becomes armed, its state is visible as armed, and the confirmation is recorded as part of its history |
| Human declines | a pending activation request | the researcher declines it | the alert stays a draft, and the response to any subsequent status read says the activation was declined |
| No sequence arms it | any sequence of tool calls, in any order, with any arguments | executed without a human confirmation | no alert ever reaches an armed state |
| Edited after request | a pending activation request | the underlying draft is edited | the pending request is invalidated and must be requested and confirmed again |
| Disarm | an armed alert | disabling is requested | the alert is immediately disarmed and stops firing; disarming needs no human confirmation, because it only ever reduces what the agent can cause |
| Disarm is idempotent | an alert that is already disarmed | disabling is requested again | the alert stays disarmed and the call succeeds without error |
| Always visible | any alert in any state | the alerts surface is viewed | its name, state (draft, pending activation, armed, disarmed), conditions, and last firing are shown |

### Export results

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a pinned run ID | an export is requested | the export contains the run's result rows, the filter tree and ranking that produced them, the universe, the run ID, the run timestamp, and the full provenance envelope |
| No silent rerun | a pinned run ID | an export is requested | the screener is not re-executed; the exported rows match the pinned run exactly |
| Provenance | any export | it is inspected | it states `as_of`, source, live/delayed status, timezone, currency, price adjustment policy, fundamentals reporting period where applicable, and calculation-engine version |
| Reproducible | an export | it is read later | it carries enough to identify exactly which screener revision and which run produced it |
| Column selection | a pinned run and a chosen subset of columns | an export is requested | only those columns are exported, including any computed fields, and the provenance is unchanged |
| Bounded | a run with a very large result set | an export is requested | the export is bounded or paginated, and states plainly that it is a bounded subset and how the rows were selected |
| Unknown run | a run ID that does not exist or has expired | an export is requested | the call is rejected saying so; no screener is re-executed to cover for the missing run |

### Contract obligations shared by every mutating tool here

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Stale revision | a mutating call carrying an `expected_revision` that no longer matches | the call is made | it is rejected without mutating anything, and the response states the current revision |
| Replay | a mutating call that already succeeded | it is repeated with the same `idempotency_key` | the original result is returned and the change is not applied a second time |
| Envelope | any successful mutation | the response is inspected | it contains `change_id`, `new_revision`, `affected_ids`, `diff_summary`, `warnings`, and `undo_token` |
| Stable IDs | any resource this feature creates | it is referenced later | it is addressed by a stable ID, never by an ordinal position or a display name |

## Non-Goals

- **Trading of any kind.** No ordering, position management, or tool that
  combines screening with order placement.
- **Arbitrary code execution.** No SQL, no JavaScript, no free-form
  executable strings, no DOM automation.
- **Agent-armed alerts.** Activation is a human act, always.
- **Alert delivery channels.** Armed alerts surface in the app's alerts
  panel; email, push, and webhooks are out of scope.
- **Change history and revision restore.** Owned by the workspace
  revisions feature, not this one.
- **Building the live reference and fundamental market-data pipeline.**
  This feature consumes the data ports; a separate workstream implements
  them.
- **Portfolio-level backtesting** — position sizing, capital allocation,
  transaction costs, and slippage. Backtests here evaluate the screen's
  historical behavior, not a trading strategy's P&L.
- **Sharing or syncing** watchlists, alerts, or exports across devices,
  browsers, or users.

## Open Questions

1. **Is `backtest_screener` synchronous?** The tool spec does not say.
   *Working assumption:* asynchronous, returning a stable `backtest_id`
   that `get_backtest_results` reads — mirroring the `run_screener` /
   `get_screener_results` split. Revisit if backtests turn out fast
   enough to return inline.
2. **Where does an export go?** The tool spec names its contents, not its
   destination. *Working assumption:* the tool returns a structured
   payload and the app offers the researcher a download; the tool never
   writes to disk or calls an external service.
3. **Are watchlists and alerts per-browser or account-scoped?** Not
   stated. *Working assumption:* per-browser, matching the app's current
   local-only persistence, behind a port so a server-backed store can
   replace it without changing the tool surface.
4. **How deep is the usable history for backtests?** Depends on the
   parallel market-data workstream. *Working assumption:* build and test
   against fixtures through the data ports; verify against real history
   when that workstream lands.
5. **What algorithm should similarity refinement use?** The tool spec
   says "adjust feature weights from accepted and rejected matches" but
   not how. *Working assumption:* a transparent, explainable adjustment
   whose every weight change can be reported with a before/after value —
   explainability is the requirement, the specific rule is an
   implementation choice.
