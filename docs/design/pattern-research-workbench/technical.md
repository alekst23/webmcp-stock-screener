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

### `WebmcpStatus` / `WebmcpBridgeState` / header status contract (T-1004-1, T-1004-2, hotfix/webmcp-tools-always-visible, hotfix/workbench-ui-refactor, hotfix/webmcp-bridge-status)

`src/lib/webmcp/status.ts`. Pure formatters backing the header's two
counts and its bridge-state line.

**Why this changed (hotfix/webmcp-bridge-status).** T-1004-1 originally
rendered `"WebMCP connected · N tools available"` with an explicit
`"WebMCP isn't available in this browser"` branch.
hotfix/webmcp-tools-always-visible deleted that branching so the count
would always show, which left the header asserting availability
unconditionally. A real agent then visited the deployed site, read
`"11 WebMCP tools available"` and the agent comment's
`"this page registers 11 tools"`, found `document.modelContext` absent,
and had to diagnose the contradiction itself before falling back to the
UI. The word `available` was doing the damage: it reads as _callable_,
which is exactly what it was not. The fix keeps the always-visible count
the hotfix wanted, renames it to the honest word (`defined` — the term
`spec.md` already used in prose), and adds a second, live count plus a
bridge-state line beside it.

| Field       | Type       | Description                                                                 |
| ----------- | ---------- | --------------------------------------------------------------------------- |
| `toolCount` | `number`   | `buildTools(engine).length` — the full defined surface, never varies        |
| `toolNames` | `string[]` | `buildTools(engine).map(t => t.name)`, same order `buildTools` returns them |

```ts
export type WebmcpBridgeState = 'connecting' | 'connected' | 'unavailable' | 'failed';
```

Four states, each mapping to a distinct real condition — collapsing any
pair loses information the agent feedback showed is load-bearing:

| State         | Cause                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| `connecting`  | `connectWebmcp()` in flight; `onMount` is sync, resolution is not      |
| `connected`   | resolved to a `WebmcpConnection`                                       |
| `unavailable` | resolved to `null` — `document.modelContext` absent (the agent's case) |
| `failed`      | rejected — `getWorkspace()` or `registerTool()` threw (T-1004-2 AC1)   |

`unavailable` and `failed` both show 0 available and must stay distinct:
one is "this browser can't", the other is "this browser could and
didn't". `connecting` must never render as `connected` — that is the
same class of premature claim this whole change exists to remove.

`formatDefinedStatus(status: WebmcpStatus) -> string` — returns
`"<toolCount> WebMCP tools defined"`. Still unconditional, still never
mentions connection state; the existing
`not.toContain('connected'|'unavailable')` guard test stays green and
keeps guarding a real invariant, because bridge state lives in a
_separate_ formatter and a separate element rather than being folded in.
Named `formatDefinedStatus`, not `formatWebmcpStatus`: its siblings are
`formatAvailableStatus` and `formatBridgeStatus`, and a generic name for
the one function whose whole job is saying "defined, not callable" is
exactly the imprecision that caused the production failure.

`formatAvailableStatus(availableCount: number) -> string` — returns
`"<availableCount> available"`. Driven by live registration, so it does
reflect feature #10's progressive availability (see the amended Non-Goal
in `spec.md`). The two counts are deliberately shown together so neither
number has to stand in for the other.

`formatBridgeStatus(state: WebmcpBridgeState) -> string` — one short
clause per state, e.g. `"agent bridge unavailable in this browser"`.
Separate from `formatDefinedStatus` for the same reason
`formatAgentToolsContext` is: different claims with different truth
conditions must not share a string.

`buildWebmcpStatus(tools: { name: string }[]) -> WebmcpStatus` — new pure
helper (hotfix/workbench-ui-refactor) so the count/name-list pairing is
computed and tested in one place instead of inline in `+page.svelte`.
Takes the minimal shape it needs (structurally compatible with
`ToolSpec[]`) rather than depending on the full `ToolSpec` type.
`+page.svelte` calls it as `buildWebmcpStatus(buildTools(engine))`.

`formatAgentToolsContext(status: WebmcpStatus, bridge: WebmcpBridgeState) -> string`
— pure helper (hotfix/workbench-ui-refactor) producing the preface +
tool-name listing for the agent-only HTML comment described below; kept
separate from `formatDefinedStatus` because the two have different
audiences and must never be merged into one string.

`--` is illegal inside an HTML comment body and would truncate the
comment early, exposing its tail as rendered page text. That escaping
now lives **inside this function** (hotfix/webmcp-bridge-status) rather
than at the `+page.svelte` call site where hotfix/workbench-ui-refactor
put it: producing comment-safe content is this function's entire job, so
a second call site should not be able to forget the `.replaceAll`. The
caller's escaping is removed rather than kept as belt-and-braces — one
owner for the invariant, tested directly against every bridge state. The
source literals write `—` directly rather than relying on the
`.replaceAll` to convert an intended em dash, so the guard has exactly
one job left — the interpolated tool names, which this module does not
control — and a reader can tell the typography from the safety net. The
preface tells the reader
this is the full defined tool surface (per feature #10's Non-Goal), not
necessarily what's currently unlocked, and to treat
`document.modelContext` itself — not this static comment — as
authoritative for live availability and schemas, so a page reload never
leaves a stale snapshot in the comment that an agent could mistake for
ground truth.

The `bridge` parameter (hotfix/webmcp-bridge-status) is **required, not
optional with a default**. A default would have to be either
`'connected'` — re-creating the exact false claim this change removes —
or `'connecting'`, which would silently mislabel every caller that
forgot to pass it. Requiring it makes every call site state its truth
condition explicitly, and the compiler enforces it.

All four states get their own wording — the function switches on
`bridge`, it does not test `bridge === 'connected'`. Collapsing the three
non-connected states into one "not callable, drive the UI" branch asserts
something untrue for two of them:

| State         | What the comment says                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connecting`  | registration is in progress and nothing is callable **yet**; the comment predates the bridge settling and is not evidence that it failed — query `document.modelContext` for live state |
| `connected`   | the page registers N tools via `document.modelContext`; call them through the WebMCP protocol                                                                                           |
| `unavailable` | not callable — `document.modelContext` is not connected here; drive the visible UI controls instead                                                                                     |
| `failed`      | `document.modelContext` **is** present, registering against it failed, so they are not callable; drive the UI, and the underlying error is in the browser console                       |

`connecting` is the load-bearing one: `onMount` is synchronous and
`connect()` needs a dozen-plus microtasks to settle, so `connecting` is
what the **first DOM render shows on a working WebMCP browser**. Emitting
the unavailable text there would send every agent to the UI fallback on
every page load — the mirror image of the original bug, and just as
false. `failed` is the other: a bridge object is right there, so telling
the reader `document.modelContext` is absent sends it looking for
something it can see.

Where a state is not callable, the comment directs the reader to the
page's visible UI controls, which perform the same operations. This is
the half the previous text lacked: the real agent correctly diagnosed the
missing bridge on its own and found the UI fallback unaided, but nothing
on the page told it that fallback existed. The tool names are still
listed in every state — knowing the surface exists is useful even when
it is not reachable, and it is what let that agent identify
`showTickerCharts` as the call it wanted.

**Human-visible vs. agent-visible tool surface (hotfix/workbench-ui-refactor):**
The original redlined mockup called for a tool-name list that's
"invisible in the UI" — i.e. present for an agent reading the page, not
rendered for the human researcher. (An earlier revision of this change
got this backwards and rendered the names as a visible `<ul>`; corrected
here.) `+page.svelte` renders the list as a real HTML comment node via
`{@html}` immediately after the `.webmcp-status` count line:

```svelte
{@html `<!-- ${formatAgentToolsContext(webmcpStatus, bridgeState)} -->`}
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

**Amended by hotfix/webmcp-bridge-status: names are now human-reachable
on request.** The original constraint was "not rendered for the human".
It is now "not rendered _until the researcher asks_": each header count
is a collapsed `<details>` whose `<summary>` is the count itself, and
whose body is the corresponding name list. Default rendering is
unchanged — no names visible, no a11y entries for them — so the redline
that motivated the comment still holds on page load.

Two things justified widening it. First, clickability buys the agent
**nothing**: agents read the DOM, and collapsed `<details>` content is
already in the DOM, exactly as the comment already was. The disclosure is
purely a human affordance, so it cannot regress the agent-facing channel.
Second, the human gained a need the agent doesn't have — until now,
feature #10's progressive availability was entirely invisible to the
researcher, with tools silently registering and retiring while the
person steering the session had no way to observe it. That is squarely
the Intent's "a human able to see and steer that process at every step."

The HTML comment is retained unchanged in its role. It is the channel
that demonstrably reached a real agent in production, and it remains the
only one that works for a reader that never renders or clicks anything.

### `WebmcpConnection` lifecycle — live registration and remount (T-1004-2)

`src/lib/webmcp/register.ts`. Two additions, both driven by T-1004-2.

`connectWebmcp(engine, activity?, onToolsChanged?)` takes a third
optional callback, invoked by `refresh()` with the current registered
names every time the set changes. `+page.svelte` uses it to keep the
available count live. A callback rather than a fourth `Writable` param:
`refresh()` already runs after every tool execute, so the change signal
exists and only needs surfacing — introducing another store to observe
it would be indirection without a second consumer to justify it.

The fire condition is `changed || !notified`, not `changed`: the **first**
refresh always reports, even when it registered nothing, so the caller
can tell "connected with zero tools" from "never heard back" and does not
sit on a stale `connecting` count forever. Every later refresh reports
only on an actual change, so a no-op sync after a tool call does not
churn the header.

`WebmcpConnection` gains `dispose(): Promise<void>`, which unregisters
every tool this connection **still owns**, best-effort — see the two
qualifications below. T-1004-2 AC2 asked whether remount needs cleanup;
it does, and the answer is not "document why it's unreachable".
`connect()` closes over a fresh `registered: Set<string>` per call, while
`document.modelContext` retains the previous mount's registrations — so a
remount re-registers every tool against a bridge that already has them,
with the new closure unaware of the old set. This is reachable in this
app today: `ssr` is disabled and `/` ↔ `/dev` is client-side navigation,
which unmounts and remounts `+page.svelte`. `session.ts` returns a
cleanup that awaits the in-flight connect and disposes it, guarded by a
`disposed` flag so a cleanup firing before the promise resolves still
tears down rather than leaking a live registration.

**Connect is atomic (hotfix/webmcp-bridge-status).** If `registerTool`
throws partway through the initial `refresh()`, `connect()` disposes what
it already registered before rethrowing. Otherwise the earlier tools stay
live on a shared bridge with no handle ever reaching the caller — and an
agent calling one of those orphans runs `sync()` → `refresh()`, which
re-registers the rest, so the header climbs to "6 available · agent
bridge failed to connect". This is what makes the `failed` state's claim
("nothing here is callable") actually true.

**`refresh()` early-returns once disposed.** A tool descriptor an agent
captured before unmount stays callable forever, and its `execute()` syncs
— without the guard, one stale call re-registers the entire surface
against a bridge no live object can ever tear down.

**Retirement and disposal are only reported when they happen.**
`ModelContext.unregisterTool` is optional in the draft spec (`types.ts`),
and the previous `mc.unregisterTool?.(name)` no-oped while
`registered.delete(name)` ran regardless — so `dispose()` reported a
clean teardown with every descriptor still live, and `refresh()`'s retire
branch dropped tools from the visible "N available" count while they
stayed callable. `connect()` now captures whether the bridge can
unregister at all; when it cannot, nothing is retired and nothing is
dropped from the reported set. The count under-reporting a live surface
is the same failure mode as over-reporting a dead one.

**Ownership across overlapping mounts.** `document.modelContext` is one
shared object and every mount registers identical tool names against it,
so unregistering by name lets a late-resolving old mount wipe a live
one's registrations — leaving the live mount reporting 6 available with 0
actually on the bridge, the worst direction to be wrong in. A
module-level `Map<toolName, generation>` records which connection last
registered each name; each `connect()` takes the next generation, and
`dispose()`/retire only touch names they still own. Disposal is also
best-effort per name: one rejecting `unregisterTool` no longer strands
the tools after it, and a name that could not be unregistered stays in
the reported set because it may well still be live.

### `startBridgeSession` — the page's bridge state machine (hotfix/webmcp-bridge-status)

`src/lib/webmcp/session.ts`.

```ts
startBridgeSession(
	engine: ResearchEngine,
	activity: Writable<AgentActivityEvent[]> | undefined,
	onState: (state: WebmcpBridgeState) => void,
	onTools: (names: string[]) => void
): () => void; // the disposer, for onMount's cleanup
```

The `connectWebmcp` result → `WebmcpBridgeState` mapping, plus the
cleanup-before-resolve race, extracted out of `+page.svelte`'s `onMount`
so it is reachable from a plain unit test. Covering it in place would
mean adding a component-testing stack (three devDeps and a
`resolve.conditions` change) that drags in `$env/dynamic/public`, the
`localStorage` singleton, and five unrelated child components — a large
dependency bill to test the few lines that decide whether the page tells
an agent the truth about callability. `+page.svelte`'s `onMount` returns
the disposer directly.

The rejection path `console.error`s the underlying error rather than
discarding it (`spec.md`'s "Bridge fails to connect" asks for the failure
to be reported with the reason surfaced). It goes to the console, not the
header: the header line has one clause, and a researcher cannot act on a
registration stack trace — but whoever is diagnosing the page can.

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
