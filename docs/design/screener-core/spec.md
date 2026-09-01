# Screener Core — Product Spec

## Intent

An agent working alongside a human researcher needs to build a stock
screener the way a person would build one in a real research terminal:
pick a universe, layer typed conditions on it, decide how matches are
ordered, check the whole thing for problems before spending money on a
query, and then run it once and get a stable handle back.

Today the app exposes an 11-tool pattern-research surface
(`src/lib/webmcp/tools.ts`) built around expression strings, ad-hoc
universes, and panels. That surface answers "where has this pattern
happened before"; it cannot answer "which instruments look like this
right now". This feature adds the screener half of the workbench: a
typed, inspectable screener definition bound to a workspace, and a
pinned execution of it.

Done looks like: an agent creates a screener, sets its universe, builds
a nested filter tree out of typed conditions, sets ranking, validates,
runs it, and hands the resulting `run_id` to the results tools — with
every step reversible, every reference a stable ID, and every number
carrying the provenance that says what data produced it.

## Preconditions

- The common workspace/revision contract (workspace IDs, revisions, the
  mutation envelope, `expected_revision`, `idempotency_key`, undo tokens,
  and the provenance type) exists — delivered by EPIC-1006.
- The catalog registry (fields, operators, studies, indicators, patterns,
  intervals, universes) exists and can be queried for a catalog item's
  parameters, units, valid ranges, defaults, outputs, and data
  availability — delivered by EPIC-1008.
- Reference and fundamental market data (sectors, industries, indexes,
  exchanges, countries, fundamentals, earnings calendars) is reachable
  through the domain ports EPIC-1008 defines. This feature consumes those
  ports; it does not source or mock that data itself.

## Features

1. **Create a screener**: mint a screener with a stable ID, bind it to a
   workspace, and give it a defined empty starting state.
2. **Set the universe**: choose what the screener is allowed to consider —
   asset class, exchanges, countries, sectors, industries, indexes,
   watchlists, liquidity limits, and explicit exclusions.
3. **Edit the filter tree**: add, update, remove, group, enable/disable,
   and reorder typed conditions inside nested `AND` / `OR` / `NOT`
   groups.
4. **Express eight condition types**: scalar, range, series comparison,
   temporal, event-relative, pattern, relative, and study-output
   conditions — each a typed model validated against the catalog, never
   arbitrary code.
5. **Set ranking**: order matches by one or more fields with weights,
   direction, tie-breaking, and a result limit.
6. **Validate a screener**: report invalid parameters, unavailable data,
   contradictory filters, expensive queries, and empty-universe problems
   before anything is executed.
7. **Run a screener**: execute one specific screener revision and return a
   pinned `run_id`, counts, warnings, and a data timestamp, so results can
   be paged later without silently re-running.

## Behavioral Specifications

### Create a screener

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | an active workspace | the agent creates a screener | a screener with a stable ID exists, is bound to that workspace, starts at screener revision 1 with an empty filter tree and a default universe, and the mutation envelope reports the new workspace revision |
| Named | a name is supplied | the agent creates a screener | the name is stored and echoed back; it is a label only and is never used to address the screener |
| Stale revision | the caller's `expected_revision` no longer matches the workspace | the agent creates a screener | the call is rejected as a revision conflict, nothing is created, and the current revision is reported |
| Replay | the same `idempotency_key` was already applied | the agent repeats the call | the original result is returned and no second screener is created |

### Set the universe

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | an existing screener | the agent sets asset class, exchanges, countries, sectors, industries, indexes, and watchlists | the universe is replaced wholesale with the supplied selection, the screener revision advances, and the envelope's diff summary names what changed |
| Liquidity limits | a universe selection | the agent adds minimum price, minimum average volume, or minimum market cap limits | those limits are stored as part of the universe and are applied before any filter condition is evaluated |
| Exclusions | a universe selection | the agent excludes specific instruments, sectors, or industries | excluded members are removed from the universe even when another criterion would have included them |
| Unknown member | a supplied exchange, country, sector, industry, or index is not in the catalog | the agent sets the universe | the call is rejected naming the unrecognized values; the universe is left unchanged |
| Empty universe | the selection resolves to zero instruments | the agent sets the universe | the change is applied but the envelope carries a warning that the universe is empty |

### Edit the filter tree

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Add a condition | a screener with an empty tree | the agent adds a condition | a node with a stable node ID is appended under the root group, the screener revision advances, and the node ID is returned in `affected_ids` |
| Add to a group | an existing group node | the agent adds a condition naming that group as parent | the node is appended inside that group and nowhere else |
| Update | an existing condition node | the agent updates its operands | only that node changes; sibling nodes and their IDs are untouched |
| Remove | an existing node | the agent removes it by ID | the node and, for a group, its whole subtree are removed; remaining node IDs are unchanged |
| Group | two or more existing sibling node IDs | the agent groups them under `AND`, `OR`, or `NOT` | a new group node replaces them in position, contains them in the given order, and the grouped nodes keep their IDs |
| Enable / disable | an existing node | the agent disables it | the node is retained in the tree but is skipped by validation and execution, and is reported as disabled |
| Reorder | sibling nodes in a group | the agent reorders them | the group's children appear in the requested order and no node IDs change |
| Nesting | groups nested inside groups | the agent builds a nested tree | `AND`, `OR`, and `NOT` combine to arbitrary depth, and `NOT` accepts exactly one child |
| Unknown node | a node ID that does not exist in this screener | any edit naming it | the call is rejected naming the unknown ID; the tree is unchanged |
| No raw code | a condition carrying a SQL string, JavaScript, or a free-form expression | the agent submits it | the call is rejected — conditions are a typed model only |

### Express eight condition types

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Scalar | a numeric catalog field | the agent adds "price greater than 10" | the condition stores field, operator, and a typed value with its unit, and validates against the field's declared type and valid range |
| Range | a numeric catalog field | the agent adds "RSI between 40 and 70" | the condition stores lower and upper bounds and their inclusivity, and is rejected if the lower bound exceeds the upper |
| Series comparison | two catalog series | the agent adds "MA50 above MA200" | the condition stores both series with their parameters and a comparison operator, and is rejected if the two series are not comparable |
| Temporal | a condition and a lookback window | the agent adds "crossed above within the last five bars" | the condition stores the inner event, the direction, the bar count, and the interval, and is rejected if the interval is not in the catalog |
| Event-relative | a calendar event type | the agent adds "earnings within the next 30 days" | the condition stores the event type, the direction (past or future), and the window, and is rejected if that event calendar is unavailable for the universe |
| Pattern | a catalog pattern | the agent adds "bull flag with confidence above 0.75" | the condition stores the pattern ID, a confidence threshold within its declared range, and the interval it is detected on |
| Relative | a field and a baseline | the agent adds "volume greater than 1.5x its 20-day average" | the condition stores the field, the baseline (its own moving average, or a peer/index reference), the multiple, and the operator |
| Study output | a catalog study and one of its named outputs | the agent adds "MACD histogram positive and rising" | the condition stores the study ID, its parameters, the named output, and the state predicate, and is rejected if the named output is not one the study declares |
| Unknown catalog item | a field, operator, study, indicator, pattern, or interval not in the registry | the agent adds a condition using it | the call is rejected naming the unknown item, and the tree is unchanged |
| Out-of-range parameter | a parameter outside the catalog item's declared valid range | the agent adds the condition | the call is rejected naming the parameter and its permitted range |

### Set ranking

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Single field | an existing screener | the agent ranks by one field descending | matches are ordered by that field descending |
| Weighted | several ranking fields with weights | the agent sets the ranking | the composite score combines the normalized fields by their weights, and the weights are echoed back as stored |
| Tie-breaking | two matches with equal scores | the screener runs | the declared tie-break field decides the order, and ordering is deterministic across repeated runs of the same revision on the same data |
| Result limit | a result limit | the agent sets the ranking | at most that many matches are returned and the run reports whether it was truncated |
| No ranking | a screener with no ranking set | the screener runs | matches are returned in a documented, deterministic default order and the run reports that no ranking was applied |
| Unknown field | a ranking field not in the catalog | the agent sets the ranking | the call is rejected naming the unknown field; the previous ranking stands |

### Validate a screener

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Clean | a well-formed screener | the agent validates it | the result reports valid with no blocking problems, and states the screener revision that was validated |
| Invalid parameter | a condition parameter outside its catalog range | the agent validates | a blocking problem names the node ID, the parameter, and the permitted range |
| Unavailable data | a field or event calendar not available for part of the universe | the agent validates | a problem names the field, the affected part of the universe, and whether it is blocking or merely degrading |
| Contradiction | two conditions that cannot both hold, such as disjoint ranges on the same field under `AND` | the agent validates | a problem names the conflicting node IDs and explains why no instrument can satisfy both |
| Expensive query | a screener whose estimated cost exceeds the configured budget | the agent validates | a non-blocking warning reports the estimate and what drives it |
| Empty universe | a universe that resolves to zero instruments | the agent validates | a blocking problem reports the empty universe and which criterion eliminated everything |
| Disabled nodes | disabled nodes in the tree | the agent validates | disabled nodes produce no problems and are reported as skipped |
| No mutation | any screener | the agent validates | nothing changes and the workspace revision does not advance |

### Run a screener

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a valid screener | the agent runs it | a run with a stable `run_id` is created, and the result reports the screener ID and revision executed, the matched count, the universe count, warnings, and the data timestamp |
| Pinned revision | a completed run | the screener is edited afterwards | the run still describes the revision it executed, and its results remain retrievable unchanged |
| Explicit revision | a screener revision the caller names | the agent runs that revision | that revision is executed, or the call is rejected if that revision is no longer retained |
| Retrievable without rerun | a completed run | the results tools ask for a page of that `run_id` | the page comes from the stored run; nothing is re-executed |
| Provenance | any run | the agent runs it | the result states `as_of`, source, live/delayed status, timezone, currency, price adjustment, fundamentals reporting period, and calculation-engine version |
| Blocking problems | a screener with blocking validation problems | the agent runs it | the run is refused and the problems are returned; no `run_id` is minted |
| Zero matches | a valid screener that nothing satisfies | the agent runs it | a run is created with a matched count of zero and a warning; this is a normal result, not an error |
| Truncated | more matches than the result limit | the agent runs it | the run reports the total matched count, the returned count, and that the result was truncated |
| Replay | the same `idempotency_key` was already applied | the agent repeats the run | the original `run_id` is returned and the screener is not executed a second time |

## Non-Goals

- Reading pages of results, selecting them, explaining a per-filter
  pass/fail breakdown, or configuring a results table — the run only
  produces the pinned handle those tools consume (EPIC-1010).
- Sourcing reference or fundamental market data — consumed through the
  ports EPIC-1008 defines, never built here.
- The catalog registry itself, and the workspace/revision/undo machinery
  itself — consumed from EPIC-1008 and EPIC-1006.
- Raw SQL, JavaScript, or any free-form expression as a filter condition.
  Deliberately excluded by `docs/reference/tool-spec.md`: conditions are a
  typed model.
- Backtesting a screener, saving results to a watchlist, exporting a run,
  or alerting on one — separate follow-up surfaces.
- Retiring the existing 11-tool pattern-research surface — that is
  EPIC-1015's job. This feature is built alongside it, in new files.

## Open Questions

1. **Run retention.** How long a completed run's stored results are kept,
   and how many runs a workspace retains, is not stated in
   `docs/reference/tool-spec.md`. *Assumption:* runs are retained for the
   life of the workspace session, and asking for a page of an evicted run
   returns an explicit "run no longer available" rather than silently
   re-running. To be confirmed with EPIC-1010.
2. **Expensive-query threshold.** The point above which a query is
   "expensive" is not specified. *Assumption:* a configurable estimated
   instrument-days budget with a documented default, surfaced as a
   non-blocking warning rather than a refusal.
3. **Composite ranking normalization.** The spec names weights but not how
   fields of different units are made comparable. *Assumption:*
   percentile-rank normalization within the matched set before weighting,
   stated in the run's output so it stays inspectable.

---

*Implemented by: EPIC-1009*
