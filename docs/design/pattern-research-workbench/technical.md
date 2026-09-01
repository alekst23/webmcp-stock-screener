# Pattern Research Workbench — Technical Design

## Contracts

The design interview surfaced three gaps against the currently implemented
types in `src/lib/webmcp/types.ts` that the query-engine tickets
(T-1001-3, T-1001-4) and integration ticket (T-1001-5) need to close:

### `InstanceEvent` — needs a completeness field

| Field          | Type                  | Description                                                                                                                                   |
| -------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ticker`       | `string`              | existing                                                                                                                                      |
| `date`         | `string`              | existing — anchor date                                                                                                                        |
| `completeness` | `number \| undefined` | new — fraction of setup steps satisfied (0–1). Absent or `1` for a fully completed instance; present and `<1` for a partial/in-progress match |

### `InstanceSetSummary` — needs a completed/partial breakdown

| Field           | Type     | Description                                  |
| --------------- | -------- | -------------------------------------------- |
| `count`         | `number` | existing — total instances in the set        |
| `completeCount` | `number` | new                                          |
| `partialCount`  | `number` | new — `count = completeCount + partialCount` |

### `FocusState` — focus and selection must be independent fields

Current shape conflates them:

```
FocusState { panelId, selected: InstanceEvent[] }
```

Needed shape — `focusInstance` (agent-driven) must not mutate `selected`
(human-driven):

| Field             | Type                    | Description                                                       |
| ----------------- | ----------------------- | ----------------------------------------------------------------- |
| `panelId`         | `string`                | existing                                                          |
| `selected`        | `InstanceEvent[]`       | existing — human multi-select, set only via direct UI interaction |
| `focusedInstance` | `InstanceEvent \| null` | new — set only via `focusInstance`, independent of `selected`     |

### `MeasureResult` — needs an exclusion note

| Field                  | Type                  | Description                                                                                        |
| ---------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `excludedPartialCount` | `number \| undefined` | new — present when the input set contained partial instances that were excluded from the statistic |

### `PriceBar` — backend panel row schema (T-1001-1)

`backend/domain/models/price.py`. One adjusted daily OHLCV row — the
shared schema the mock generator and the real EODHD pipeline (T-1001-9)
both must produce, so swapping one panel for the other requires no
downstream code changes.

| Field    | Type    | Description |
| -------- | ------- | ----------- |
| `ticker` | `str`   |             |
| `date`   | `date`  |             |
| `open`   | `float` | adjusted    |
| `high`   | `float` | adjusted    |
| `low`    | `float` | adjusted    |
| `close`  | `float` | adjusted    |
| `volume` | `int`   |             |

### `SpikePingResponse` — throwaway spike DTO (T-1001-2)

`backend/api/schemas/spike.py`. Proves a WebMCP tool's `execute()` can
reach a live deployed backend. Superseded by the real tool endpoints wired
in T-1001-5 — not part of the permanent API surface.

| Field     | Type       | Description                      |
| --------- | ---------- | -------------------------------- |
| `message` | `str`      |                                  |
| `sample`  | `PriceBar` | one row read from the mock panel |

### `PatternResearchEngine` — query engine contract (T-1001-3, extended by T-1001-4)

`backend/domain/contracts/engine.py`. Implemented by a pandas/numpy infra
adapter; a `MockPatternResearchEngine` fake lives in
`backend/tests/mocks/` for callers' tests.

| Method                 | Signature                                                                        | Description                                                        |
| ---------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `define_study`         | `(name, expression) -> Study`                                                    | raises `ExpressionError` (with catalog) on an unsupported function |
| `define_setup`         | `(name, steps) -> Setup`                                                         |                                                                    |
| `find_instances`       | `(setup, from_date, to_date, min_market_cap, sectors) -> InstanceSet`            | applies the partial-match fallback and dedup rules from `spec.md`  |
| `sample_instances`     | `(instance_set, n, strategy, horizon_days) -> list[Instance]`                    | T-1001-4                                                           |
| `measure`              | `(instance_set, horizon_days, metric, compare_to_base_rate) -> MeasureResult`    | T-1001-4 — excludes partial instances                              |
| `split_instances`      | `(instance_set, mode, expression, horizon_days, threshold) -> list[InstanceSet]` | T-1001-4                                                           |
| `get_instance_windows` | `(instance_set, n, strategy, window) -> list[InstanceWindow]`                    | T-1001-4 — backs `showGrid`'s data needs                           |

### `MeasureResult`, `BaseRateResult`, `InstanceWindow` — stats models (T-1001-4)

`backend/domain/models/measurement.py`. `MeasureResult.excluded_partial_count`
mirrors the frontend `MeasureResult` field of the same name documented
above.

### `Study`, `SetupStep`, `Setup` — pattern domain models (T-1001-3)

`backend/domain/models/pattern.py`. Backend-side mirror of the frontend's
`StudySummary`/`SetupStep`/`SetupSummary` types.

### `Instance`, `InstanceSet` — result domain models (T-1001-3)

`backend/domain/models/instance.py`. `InstanceSet.complete_count` /
`partial_count` are stored fields (not derived), matching the
`InstanceSetSummary` breakdown documented above.

### `FUNCTION_CATALOG` / `SUPPORTED_FUNCTIONS` — deliberately duplicated (T-1001-5)

`src/lib/webmcp/types.ts`'s `FUNCTION_CATALOG` mirrors
`backend/tests/mocks/mock_pattern_research_engine.py`'s
`SUPPORTED_FUNCTIONS` (and, once T-1001-3's real engine exists, whatever
canonical list it uses). Kept in sync by hand — a list of ~6-12 function
names, not parsing logic, so this is cheap duplication in exchange for
`defineStudy`/`defineSetup` staying client-side per `docs/plan.md`'s
architecture split.

### `ApiClientConfig` — frontend backend-URL contract (T-1001-5)

`src/lib/webmcp/types.ts`. `{ baseUrl: string }` — where the fetch-based
`ResearchEngine` implementation sends the 5 networked tool calls.

### `AgentActivityEvent` — activity feed contract (T-1001-7, extended by EPIC-1002)

`src/lib/workspace/activity.ts`. Originally populated only by
`register.ts`'s tool-call wrapper; EPIC-1002 (T-1002-1) adds a shared
recording entry point so a human-triggered UI control (e.g.
`ChartToolbar.svelte`) appends events the same way, and persists the
resulting store (T-1002-2, mirroring `store.ts`'s existing
localStorage pattern).

| Field       | Type                 | Description                                                                                                                                                                            |
| ----------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | `string`             |                                                                                                                                                                                        |
| `actor`     | `'human' \| 'agent'` | new (T-1002-1) — set statically per call site, not runtime-detected: the tool-registration path (`register.ts`) is always `'agent'`, a direct UI-control call site is always `'human'` |
| `toolName`  | `string`             |                                                                                                                                                                                        |
| `timestamp` | `string`             | ISO                                                                                                                                                                                    |
| `input`     | `unknown`            | the call's raw input                                                                                                                                                                   |
| `summary`   | `string`             | one-line human-readable result summary, not raw JSON                                                                                                                                   |

**Shared recording entry point (T-1002-1):** `activity.ts` exports
`recordAction(activity, actor, actionName, input, result: ToolResult)`.
Both `register.ts`'s tool wrapper (`actor: 'agent'`) and any
human-triggered UI control (starting with `ChartToolbar.svelte`, `actor:
'human'`) call this one function to append an event — no call site
writes to `activityStore` any other way. It reuses the existing
`summarizeToolCall` logic (not duplicated) for both paths; `tools.ts`'s
`ok`/`fail` `ToolResult` builders are exported so `ChartToolbar.svelte`
can build the same result shape without re-implementing it.

### `WebmcpStatus` / `formatWebmcpStatus` / `buildWebmcpStatus` — header status contract (T-1004-1, hotfix/webmcp-tools-always-visible, hotfix/workbench-ui-refactor)

`src/lib/webmcp/status.ts`. Pure formatter backing the header's "WebMCP
tool count always visible" scenario. `toolCount` is
`buildTools(engine).length` — the full defined tool surface, unaffected by
feature #10's progressive availability. Computed synchronously in
`+page.svelte`'s `onMount`, independent of `connectWebmcp()`'s resolution
— the header no longer waits on or reflects actual connection state
(dropped by hotfix/webmcp-tools-always-visible; `connectWebmcp()` still
runs, for real WebMCP registration, it just no longer gates the header).

| Field       | Type       | Description                                                                                                      |
| ----------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `toolCount` | `number`   | `buildTools(engine).length`                                                                                      |
| `toolNames` | `string[]` | new (hotfix/workbench-ui-refactor) — `buildTools(engine).map(t => t.name)`, same order `buildTools` returns them |

`formatWebmcpStatus(status: WebmcpStatus) -> string` — always
`"<toolCount> WebMCP tools available"` (hotfix/workbench-ui-refactor
adds the "WebMCP" word for clarity), regardless of browser support or
connection state. Unchanged by the `toolNames` addition — the name list
is never rendered as visible UI (see below), so the existing exact-match
tests stay valid.

`buildWebmcpStatus(tools: { name: string }[]) -> WebmcpStatus` — new pure
helper (hotfix/workbench-ui-refactor) so the count/name-list pairing is
computed and tested in one place instead of inline in `+page.svelte`.
Takes the minimal shape it needs (structurally compatible with
`ToolSpec[]`) rather than depending on the full `ToolSpec` type.
`+page.svelte` calls it as `buildWebmcpStatus(buildTools(engine))`.

`formatAgentToolsContext(status: WebmcpStatus) -> string` — new pure
helper (hotfix/workbench-ui-refactor). Produces the preface + tool-name
listing for the agent-only HTML comment described below; kept separate
from `formatWebmcpStatus` because the two have different audiences and
must never be merged into one string. Any literal `--` in the output is
replaced with an em dash (`—`) before the caller wraps it in `<!-- -->`,
since `--` is illegal inside an HTML comment body and could otherwise
truncate it early — defensive only, `toolNames` is a static, hardcoded
list, not user input. The preface also tells the reader this is the full
defined tool surface (per feature #10's Non-Goal), not necessarily
what's currently unlocked, and to treat `document.modelContext` itself
— not this static comment — as authoritative for live availability and
schemas, so a page reload never leaves a stale snapshot in the comment
that an agent could mistake for ground truth.

**Human-visible vs. agent-visible tool surface (hotfix/workbench-ui-refactor):**
The original redlined mockup called for a tool-name list that's
"invisible in the UI" — i.e. present for an agent reading the page, not
rendered for the human researcher. (An earlier revision of this change
got this backwards and rendered the names as a visible `<ul>`; corrected
here.) `+page.svelte` renders the list as a real HTML comment node via
`{@html}` immediately after the `.webmcp-status` count line:

```svelte
{@html `<!-- ${formatAgentToolsContext(webmcpStatus).replaceAll('--', '—')} -->`}
```

A literal `<!-- -->` written directly in a `.svelte` template is stripped
by the Svelte compiler by default and would never reach the shipped
HTML — using `{@html}` to inject the comment string at runtime avoids
that, since Svelte's template-comment stripping only applies to comments
written statically in the template source, not to strings passed through
`{@html}`. The result: no visible text, no accessibility-tree entry
(comment nodes aren't exposed to a11y trees), but the comment is present
in the page's rendered HTML for anything that reads page source —
exactly the "invisible in the UI, visible to an agent" scenario in
`spec.md`.

### `clearActivity` — manual full-log clear (hotfix/workbench-ui-refactor)

`src/lib/workspace/activity.ts`. The one exception to `recordAction`
being the sole append-only mutator (see the amended Non-Goal in
`spec.md`) — a whole-log wipe, not a per-entry edit/delete.

| Signature                                                       | Description                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clearActivity(activity: Writable<AgentActivityEvent[]>): void` | `activity.set([])`. The existing `subscribe`-based persistence writes the cleared (empty) array to `localStorage` automatically — no separate storage call needed. `nextActivityId` is intentionally left unreset, so IDs after a clear keep incrementing rather than restart at 1; avoids any theoretical key collision with entries rendered before the clear. |

`ActivityFeed.svelte` gains an `onclear?: () => void` callback prop,
mirroring the `ChartToolbar`/`SnapshotPicker` convention, wired in
`+page.svelte` as `onclear={() => clearActivity(activityStore)}`. The
Clear-log button's click handler guards the call with a plain global
`confirm()`, mirroring `SnapshotPicker.svelte`'s `load()` guard.

### Page layout — activity log position and snapshot picker density (hotfix/workbench-ui-refactor)

`src/routes/+page.svelte` moves `<ActivityFeed>` from directly after the
intro paragraph to after `<FocusChart>` (last element in `<main>`),
matching the new "Log is positioned at the bottom" scenario. No prop or
store wiring changes from the move itself. `ActivityFeed.svelte` adopts
the same `border-top`/`border-bottom` section-divider convention already
shared by `ChartToolbar.svelte` and `SnapshotPicker.svelte`, for visual
consistency now that it sits as a peer section rather than an
intro-adjacent block.

`SnapshotPicker.svelte`'s layout change is CSS-only (reduced `gap`,
`padding`, and `margin` in its existing `<style>` block) — no markup,
prop, or behavioral change, so `workspace-snapshots/spec.md` and
`technical.md` are unaffected.

### `TickerMetadata` — universe classification (T-1001-9)

`backend/domain/models/universe.py`. Sourced from a free Nasdaq screener
CSV export, not EODHD.

| Field        | Type            | Description |
| ------------ | --------------- | ----------- |
| `ticker`     | `str`           |             |
| `sector`     | `str \| None`   |             |
| `market_cap` | `float \| None` |             |
| `as_of`      | `date`          |             |

### `removePanel` — single-panel removal (T-1003-2)

`src/lib/workspace/store.ts`. Human-driven store mutation, not a
`ResearchEngine`/WebMCP tool method — same category as `selectInstance`.
Called directly from `GridPanel.svelte`'s close button.

| Signature                                                             | Description                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `removePanel(store: Writable<WorkspaceState>, panelId: string): void` | removes the matching panel from `ws.panels`; if it was the focused panel (`ws.focus?.panelId === panelId`), resets `ws.focus` to `null` (mirrors `clearPanels()`'s full focus reset, scoped to the single-panel case). Leaves `instanceSets`/`studies`/`setups` untouched. |

## Data Flow

Partial-match fallback happens inside `findInstances` only — sampling,
measuring, splitting, and grid rendering all operate on whatever mix of
complete/partial instances they're handed; only `measure` (and by
extension anything relying on a resolved outcome) needs to filter partials
out internally.

The partial-match threshold (fewer than 5 completed matches triggers
inclusion of partials) and the completion score formula (fraction of
setup steps satisfied) are behavioral decisions made in this spec, not
implementation details — see `spec.md`'s "Instance search" scenarios. Do
not re-derive or change them without updating the spec first.

---

_Product design: [spec.md](spec.md)_
