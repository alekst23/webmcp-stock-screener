# Pattern Research Workbench — Product Spec

## Intent

A trader or researcher, working alongside an AI agent in the same browser
tab, wants to turn a vague visual chart pattern into a tested hypothesis —
faster than either could alone. The system lets both of them define a
derived data series, describe a multi-step temporal pattern, search
history for every place it occurred, and evaluate whether it actually
predicts anything, all through a shared, visible research session. Done
looks like: a complete research cycle (define → search → sample → measure
→ visualize) carried out entirely through WebMCP tool calls by a real
agent in a real browser, with a human able to see and steer that process
at every step.

## Preconditions

- A WebMCP-capable browser/agent runtime is available (e.g. Chrome with
  WebMCP enabled, or a WebMCP-capable in-app browser). Without one, no
  agent-driven behavior in this spec is reachable — only the manual/dev
  control surface is.
- The backend API is deployed and reachable for the five tools that need
  it (`findInstances`, `measure`, `splitInstances`, `showGrid`,
  `sampleInstances`). During initial development this serves a synthetic
  panel; later it serves the real data pipeline — the behavior described
  here is identical either way.
- A price panel (mock or real) is loaded and available to the backend. An
  unloaded/empty panel is a degenerate startup state, not a normal
  scenario this spec covers.

## Features

1. **Study definition**: define a named derived series (e.g. relative
   volume, gap %) from an expression over price/volume data, for later use
   in patterns, metrics, or chart overlays.
2. **Temporal setup definition**: define a chart pattern as an ordered
   sequence of conditions, optionally constrained to occur within a
   trading-day window after the previous step and/or required to hold
   continuously across that window.
3. **Instance search**: search the loaded universe for every occurrence of
   a defined pattern, with an automatic fallback to surfacing in-progress
   (not-yet-resolved) matches when completed matches are scarce.
4. **Instance sampling**: pull a representative subset of matches from a
   result set by strategy (recent, random, best/worst-performing).
5. **Outcome measurement**: measure a metric (default: forward return)
   across every completed instance in a result set, compared against the
   same metric computed over the broader universe.
6. **Instance splitting**: split a result set into labeled sub-sets, either
   by outcome (winners/losers) or by an arbitrary condition.
7. **Grid visualization**: render a set of instances as small, aligned
   charts for visual comparison, with a small set of actions attached
   directly to the panel — not a disconnected control elsewhere on the
   page. At minimum: toggle a histogram view of that panel's own outcome
   distribution, and close/remove that specific panel.
8. **Instance focus**: zoom a panel to a single instance for close
   inspection, independent of what the human has selected by hand.
9. **Shared workspace & collaboration**: a single visible research session
   — defined studies/patterns/results/panels, what's currently
   selected/focused, and a complete ordered log of every action taken —
   that both the human (via direct interaction) and the agent (via tool
   calls) read from and write to, persisted per browser. Every action
   either party takes appears in one timeline, labeled by who did it, so a
   person watching the session can trust it as a full transactional
   record rather than inferring history from a state snapshot.
10. **Progressive tool availability**: the set of tools an agent can call
    expands as the research workflow advances (e.g. measurement tools only
    appear once a search has produced results), rather than exposing the
    full surface unconditionally.

## Behavioral Specifications

### Study definition

| Scenario           | Given                                                           | When                                               | Then                                                                                                                               |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Happy path         | a valid expression over supported price/volume functions        | a study is defined with a name and that expression | the study is added to the workspace and becomes referenceable by name in patterns, metrics, and overlays                           |
| Invalid expression | an expression using an unsupported function or malformed syntax | a study is defined with it                         | the definition is rejected with a response listing every currently supported function, so the caller can correct it in one attempt |

### Temporal setup definition

| Scenario            | Given                                                                                    | When                  | Then                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Happy path          | 2+ condition steps, later steps constrained by a trading-day window after the prior step | a setup is defined    | the setup is added to the workspace and becomes searchable via instance search                                   |
| Sustained condition | a step marked to hold continuously across its window                                     | the setup is searched | a candidate only matches that step if the condition holds on every day of the window, not just one day within it |

### Instance search

| Scenario                               | Given                                                                                                             | When                       | Then                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path                             | a defined setup and an optional date range/universe filter                                                        | instances are searched for | every ticker/date where the full sequence completed is returned, with a total count and the date range covered                                                                                                                                                                                                                                |
| Sparse completed matches               | fewer than 5 completed matches are found                                                                          | the same search runs       | in-progress matches (patterns that have satisfied their earlier steps but whose final step hasn't yet resolved, because the dataset's most recent day doesn't yet cover that step's window) are also included, each carrying a completion score (fraction of steps satisfied), and the result reports completed and partial counts separately |
| Repeated occurrences                   | a ticker independently satisfies the full pattern more than once within the search window                         | instances are searched for | each occurrence counts as a separate instance — occurrences are not merged or deduplicated across independent completions                                                                                                                                                                                                                     |
| Redundant completion of one occurrence | a single pattern start could technically be resolved by more than one valid completion within the allowed windows | instances are searched for | only the earliest valid completion for that start is counted — this is not treated as two separate instances                                                                                                                                                                                                                                  |

### Instance sampling

| Scenario   | Given                                           | When                  | Then                                                                                         |
| ---------- | ----------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| Happy path | an existing result set and a selection strategy | a sample is requested | the requested number of concrete ticker/date instances are returned, chosen by that strategy |

### Outcome measurement

| Scenario                  | Given                                                                      | When                       | Then                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path                | an existing result set and a measurement horizon                           | a metric is measured       | summary statistics (count, central tendency, hit rate) are returned for the set, compared against the same statistic computed over the broader universe                                |
| Partial instances present | a result set containing both completed and partial (in-progress) instances | a metric is measured on it | only completed instances are included in the statistic; the result states how many partial instances were excluded, since a forward return doesn't exist yet for an unresolved pattern |

### Instance splitting

| Scenario   | Given                  | When                                            | Then                                                                                                                                      |
| ---------- | ---------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path | an existing result set | a split by outcome or by condition is requested | the set is divided into labeled child sets (e.g. winners/losers), each independently usable by every other tool that accepts a result set |

### Grid visualization

| Scenario                   | Given                                                   | When                                 | Then                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path                 | an existing result set                                  | a grid is requested                  | a panel is created showing a sample of instances as small charts aligned at each instance's anchor date, optionally normalized and overlaid with studies |
| Includes partial instances | a result set containing partial (in-progress) instances | a grid is requested including them   | each partial instance's chart shows the price action that has occurred so far, without implying an outcome that hasn't happened yet                      |
| Panel-scoped histogram     | an open grid panel tied to an instance set              | the panel's histogram action is used | a histogram of that same instance set's outcome distribution is shown, visibly associated with that panel — not a separate, disconnected control         |
| Individual panel removal   | one or more open panels                                 | a single panel is closed             | only that panel is removed from the workspace; other open panels are unaffected                                                                          |

### Instance focus

| Scenario                        | Given                                    | When                                   | Then                                                                                     |
| ------------------------------- | ---------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Happy path                      | an open panel                            | a specific instance is focused         | the panel zooms to show that instance in detail                                          |
| Does not affect human selection | a human has instances selected in the UI | the agent focuses a different instance | the human's selection is unchanged — focus and selection are independent pieces of state |

### Shared workspace & collaboration

| Scenario                                        | Given                                                                                                       | When                                                                                                | Then                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path                                      | any combination of defined studies/patterns/results/panels and current selection/focus                      | the workspace is read                                                                               | the full current state is returned, including what the human has selected by hand, so the agent can act on references like "these ones"                                                                                                                         |
| Persistence                                     | a session with existing workspace state                                                                     | the page is reloaded in the same browser                                                            | the workspace state is restored as it was                                                                                                                                                                                                                       |
| Cross-actor visibility                          | the human changes something directly in the UI (e.g. selects an instance)                                   | the agent subsequently reads the workspace                                                          | the agent sees the human's change                                                                                                                                                                                                                               |
| Unified action log                              | any action that changes the session — a human interacting with a UI control, or an agent invoking a tool    | the action completes (success or failure)                                                           | one entry is appended to a single ordered log, showing who did it ("Human" or "Agent"), what action, a human-readable summary of the result, and when                                                                                                           |
| Human actions are visible                       | a human triggers an action through a UI control (not the `/dev` testing harness)                            | the action completes                                                                                | it appears in the same log as agent actions, in true chronological order relative to them                                                                                                                                                                       |
| Failed actions are visible                      | an action (human or agent) fails                                                                            | the failure occurs                                                                                  | the log shows the failure with a readable reason, not silently dropped                                                                                                                                                                                          |
| Log persists across reloads                     | a session with existing logged actions                                                                      | the page is reloaded in the same browser                                                            | the full log is restored, matching how the rest of workspace state already persists                                                                                                                                                                             |
| Log is positioned at the bottom                 | the page renders any amount of workspace content (panels, charts, controls)                                 | the researcher looks for the activity log                                                           | it appears at the bottom of the page, below all panels and the focus chart, rather than above the research controls                                                                                                                                             |
| Manual full-log clear                           | a session with one or more logged actions                                                                   | the researcher uses the "Clear log" control                                                         | every entry is removed from the log at once and the cleared state persists across reloads; this does not affect studies, setups, result sets, or panels                                                                                                         |
| WebMCP tool counts always visible               | the page loads                                                                                              | the researcher looks at the page header                                                             | it shows two counts: the total number of tools the app defines (e.g. "11 tools defined") and the number currently callable by an agent (e.g. "5 available"). The defined count never varies with browser support or workflow state                              |
| Bridge unavailable in this browser              | the browser does not support `document.modelContext`                                                        | the page loads                                                                                      | the available count is 0 and the header states the bridge is unavailable in this browser — never a state implying the tools are callable when they are not                                                                                                      |
| Bridge fails to connect                         | the browser supports `document.modelContext` but registration rejects (network error, malformed descriptor) | the page loads                                                                                      | the available count is 0 and the header reports the failure distinctly from the unsupported-browser case, with a readable reason — not a blank, stale, or silently-successful header                                                                            |
| Available count tracks progressive availability | a connected bridge and a workflow action that unlocks or retires tools (feature #10)                        | the tool set changes                                                                                | the available count updates to match what is currently registered, without a page reload; the defined count is unchanged                                                                                                                                        |
| Tool names revealed on request                  | the page loads                                                                                              | the researcher clicks either count                                                                  | the corresponding tool names are revealed — all defined names, or just the currently-callable ones. Names are not rendered until requested; neither list is shown by default                                                                                    |
| Agent context comment states callability        | the page loads                                                                                              | an agent (or anything else reading the page's HTML source, not the rendered view) inspects the page | an HTML comment lists every defined tool name and states plainly whether they are callable in this session. When no bridge is present it says they are not callable and directs the reader to the page's visible UI controls, which perform the same operations |

### Progressive tool availability

| Scenario   | Given                          | When                                     | Then                                                                                                                                                    |
| ---------- | ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path | no result set yet exists       | the agent inspects available tools       | tools that require a result set (sampling, measuring, splitting, grid) are not available; tools that don't (defining, searching, reading workspace) are |
| Unlocking  | a search produces a result set | the agent inspects available tools again | the previously unavailable tools become available immediately                                                                                           |

## Non-Goals

- User accounts, authentication, or any per-user identity — the workspace
  is anonymous and local to one browser.
- Editing or deleting previously defined studies, setups, or result sets
  — the workspace is append-only within a session for these; starting
  over means defining something new or reloading the page. Panels are the
  one exception: closing a panel removes that visualization only — the
  underlying study, setup, or result set it was built from is unaffected
  and remains in the workspace.
- Syncing workspace state across tabs, devices, or browsers — state is
  local to the single tab it was created in.
- Intraday data, options data, or historical fundamentals — the workbench
  operates on daily price/volume data only.
- Any live third-party data API call at request time — external data
  sources are ingestion-time only.
- Chart interactivity beyond selection and zoom (e.g. manual drawing
  tools).
- The `/dev` control surface (developer testing harness, no agent or
  WebMCP browser involved) does not write to the action log — it is a
  separate, disconnected tool.
- The raw current-state snapshot view is removed; the log is the sole
  visible record of session activity going forward (current panel/chart
  rendering is unaffected — only the redundant text snapshot goes away).
- Editing, deleting, or reordering _individual_ log entries — the log is
  append-only for single entries, matching the workspace's existing
  append-only model. The one exception is a deliberate, all-or-nothing
  "Clear log" action (see Shared workspace & collaboration) that wipes
  every entry at once; there is still no way to remove or reorder just
  one entry.
- New panel kinds beyond grid + its histogram toggle.
- Reordering or resizing panels.
- The header's _defined_ tool count reflecting progressive availability
  (feature #10) — that number is the full defined tool surface and never
  varies. The separate _available_ count does reflect what is currently
  unlocked; the two are shown together precisely so neither has to stand
  in for the other.
- Diagnosing or remediating a missing WebMCP bridge — the header reports
  that the bridge is unavailable, but does not instruct the researcher on
  how to enable it, detect why it is missing, or offer a retry.

## Open Questions

None outstanding.

---

_Implemented by: EPIC-1001, EPIC-1002, EPIC-1003, EPIC-1004, hotfix/webmcp-tools-always-visible, hotfix/workbench-ui-refactor, hotfix/webmcp-bridge-status_
