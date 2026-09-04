# Tool Surface MVP

The minimum set of WebMCP tools an agent needs to serve the MVP use case
correctly. Derived from the use case forward — "what does the agent need to
do?" — not from the existing inventory backward. Overlap with existing tools
is recorded per tool, but reuse is never the reason a tool is on the list.
Where the existing tool and the correct tool differ, the correct one wins.

Companion to [Tool Surface Status](tool-surface-status.md) (what's registered
today).

## The use case

1. User: **"Find energy sector stocks with highest gains in the past 48 hrs."**
   The agent builds and runs a screen and the user sees a ranked list.
2. User: **"Show me details for X and Y."**
   The agent opens a detail view per named instrument next to the list.

Follow-ups the MVP must not fall over on, because they're the obvious next
sentence: "make it top 20", "only ones above $10", "close those two",
"what's on screen right now?".

## What the agent must be able to do

Each capability below is a hard requirement of the use case. The tool list
in the next section is the smallest set that delivers all of them.

| # | Capability | Why it's required for correctness |
|---|---|---|
| A | Look up the engine's vocabulary (fields, operators, sectors, intervals) | "Energy sector" and "gains over 48 hrs" must map to ids the engine actually has. An agent that guesses `field.change_48h` produces a confident wrong answer, not an error. |
| B | Define a screener — universe, conditions, ranking, limit — **atomically**, with validation in the same step | A screener half-built across four calls has intermediate states a run could observe. Validation must report *every* problem, not the first, or the agent loops. |
| C | Execute the screener and get a pinned, immutable run with provenance | The user asked about "the past 48 hrs" — the answer is only correct alongside `as_of`, delayed/live status, and whether results were truncated. Later edits must never change what a run says. |
| D | Read the run's rows: instrument id, symbol, name, and the ranking values | The agent has to say "XOM +4.2%" and, later, map "X" back to an instrument id. Ids come from here, never from re-typing the ticker. |
| E | Put the results on the canvas | The user sees the list. If the agent claims a result the user can't see, that's a correctness failure. |
| F | Resolve a name/ticker the user typed to an instrument id, honestly | "X" is normally a row from D. When it isn't ("show me Exxon"), the agent needs a lookup that either returns a real instrument or says it can't — never silently mints one. |
| G | Open a detail view for an instrument | "Details" today means a chart panel (daily bars). `symbol_details` is a placeholder kind with no renderer. |
| H | See the canvas: panel ids, kinds, sources, positions | Every follow-up ("close those two") needs panel ids. Also lets the agent verify its own action landed before telling the user it did. |
| I | Remove a panel | "Close those two." |
| J | Position panels | "Put the charts next to the list." Auto-placement covers the first render; explicit positioning covers the follow-up. |

## The tools (9)

### 1. `search_catalog`
Capability A. Text/tag search over the catalog: fields, operators, studies,
indicators, intervals, universes, and — **required addition** — the valid
values of enumerated fields like `field.sector`. Returns ids and the
parameter schema per item so the agent can compose a correct condition.

- Must return: item id, kind, label, description, parameter schema, and
  for enumerated fields the accepted values.
- Overlap: `webmcp/discovery/searchCatalog.ts` exists and does most of this;
  it is registered nowhere. It does not enumerate sector values today.

### 2. `search_instruments`
Capability F. Ticker or name → `instrument_id`, `symbol`, `name`,
`exchange`. Returns an explicit "unavailable" result when no reference data
source is wired.

- Must never invent an instrument. If a provisional reference is the only
  way to bind a chart (see blocker 4), the result must carry
  `provisional: true` and the agent must relay that to the user.
- Overlap: `webmcp/discovery/searchInstruments.ts` (honest-unavailable,
  unregistered) and `chart/tools/resolveTicker.ts` (registered; mints
  provisional refs with exchange "unknown"). These are one capability split
  into two tools by circumstance. MVP wants one tool with the honest
  behaviour and the provisional path flagged, not a separate minting tool.

### 3. `define_screener`
Capability B. One call, one payload: `universe` (asset class, sectors,
exchanges, indexes, liquidity floors, exclusions), `conditions` (a filter
tree of catalog-validated nodes), `ranking` (fields + weights + direction +
tie-break), `limit`. Creates the screener, or — given `screener_id` — replaces
its definition as a new revision. Validates everything and returns either the
new `screener_id`/`revision` or the complete list of problems.

- Full-replace semantics, not patch. "Make it top 20" is the same payload
  with `limit: 20`. This removes an entire class of node-id bookkeeping
  errors the agent would otherwise have to get right across turns.
- Must reject unknown catalog ids, out-of-range parameters, and an empty
  universe, and must report *all* of them together.
- Must state its data granularity in the response when a time-based request
  is approximated (daily bars → "48 hrs" ≈ 2 sessions).
- Overlap: replaces five existing tools — `create_screener`,
  `set_screener_universe`, `edit_filter_tree`, `set_screener_ranking`,
  `validate_screener`. Their domain logic (filter-tree validation, ranking
  normalisation, universe resolution) is reusable; their tool boundaries are
  not. **New tool.**

### 4. `run_screener`
Capability C + E. Executes one screener revision, pins the result set under
a `run_id`, and by default presents it: binds the workspace's results table
panel to the run (creating one if none exists) and returns that `panel_id`.

- Response must include `as_of`, live/delayed, universe/matched/returned
  counts, `truncated`, and `ranking_applied`. A run over an empty universe
  is a refusal with reason, never an empty success.
- Overlap: `webmcp/screener/runScreener.ts` (commented out) already does
  the pin + auto-bind. **Reuse as-is.**

### 5. `get_screener_results`
Capability D. A page of rows for a `run_id`: `instrument_id`, `symbol`,
`name`, every ranking field's value, and the run's provenance. Cursor for the
next page. Read-only — never re-runs.

- Overlap: `results/tools/resultsTools.ts` (active). **Reuse as-is.** Confirm
  `name` is in the projection; the agent needs it to resolve "Exxon" → row.

### 6. `create_panel`
Capability G (and E's fallback). Creates a panel of a kind with an initial
source and renderer, auto-placed in the first free cell. For the use case:
`kind: 'chart'`, `source: { type: 'instrument', ref }`. Returns the panel id.

- Overlap: `panels/tools/lifecycleTools.ts` (active). **Reuse as-is.** The
  fact that it takes source + renderer at creation is what makes
  `bind_panel_source` and `set_panel_renderer` unnecessary for MVP.

### 7. `get_canvas_state`
Capability H. Every panel: id, kind, title, source, renderer, rect. Plus the
active workspace id and the currently pinned run ids.

- Overlap: `workbench/tools/index.ts` (commented out). **Reuse; verify** it
  reports sources and pinned runs, not just geometry.

### 8. `remove_panel`
Capability I. By stable panel id.

- Overlap: `panels/tools/lifecycleTools.ts` (active). **Reuse as-is.**

### 9. `set_panel_layout`
Capability J. Applies a batch of `{ panel_id, rect }` atomically; panels not
named keep their rect. The single layout primitive — split, templates,
duplicate, and maximize are all expressible as this plus `create_panel`, or
are UI-only.

- Overlap: `panels/tools/layoutTools.ts` (active). **Reuse as-is.**

## Deliberately absent

| Existing tool | Why it's not needed |
|---|---|
| `create_screener`, `set_screener_universe`, `edit_filter_tree`, `set_screener_ranking`, `validate_screener` | Folded into `define_screener`. Four sequential mutations for one sentence is where correctness goes to die: partial definitions, stale revision numbers, node-id bookkeeping. |
| `resolve_ticker` | Folded into `search_instruments` with an explicit provisional flag. A tool whose purpose is to mint an unverified reference should not be a standalone, unlabelled capability. |
| `split_panel`, `apply_layout_template`, `duplicate_panel` | Expressible via `create_panel` + `set_panel_layout`. |
| `maximize_panel` | Client-only state, no revision. A UI affordance, not an agent action. |
| `bind_panel_source`, `set_panel_renderer`, `configure_chart_grid`, `configure_panel_view` | Mutate-in-place configuration. MVP creates panels with the right source/renderer and defaults; if they need to change, remove and recreate. |
| `link_panels`, `unlink_panels`, `set_panel_selection` | The sync-channel model is a concept the use case never exercises. "Show X and Y" is two panels. |
| `explain_result` | Correct and valuable, but "why is X in the list?" is not in the use case. First candidate to add after MVP. |
| `describe_catalog_item` | `search_catalog` returns the schema inline; a second lookup isn't needed. |
| `get_app_context`, `create_workspace`, `save_workspace`, `undo_change`, `get_change_history`, `restore_workspace_revision`, `preview_workspace_changes`, `apply_previewed_changes` | Workspace lifecycle and safety — not exercised by the use case. |
| Chart authoring, similarity, follow-up, watchlist, alerts, backtest, export | Other features. |

## Correctness blockers that no tool list fixes

These stop step 1 from producing a true answer today regardless of which
tools are registered. They are the actual MVP work.

1. **No screener market-data adapter is wired.** Every real evaluation refuses
   with `empty_universe` (`workbenchCompositionRoot.ts:108-112`). The backend
   serves bars — the chart panel already reads them over HTTP — so this is an
   adapter, not a data problem.
2. **No "percent change over N sessions" field.** The catalog has
   `field.price.close` and `indicator.gap_percent` (single session) but nothing
   that expresses "gain over the past 48 hrs". Needs a ranking-capable field,
   e.g. `field.price.change_pct` with a `lookback_sessions` parameter.
   Without it the flagship sentence cannot be ranked.
3. **Sector isn't plumbed to the frontend.** The backend already holds
   `sector` and `market_cap` per ticker as static metadata
   (`backend/domain/models/universe.py`, loaded by
   `scripts/load_universe_metadata.py` from a Nasdaq screener CSV), but the
   frontend's instrument directory is the honest-unavailable stub and
   `InstrumentQuery` has no sector field (`setScreenerUniverse.ts:103-109`).
   Wiring, not sourcing. Fundamentals (P/E, revenue) are a different story —
   `NoFundamentalsPort` is the only implementation and there is no
   point-in-time source — and are out of MVP scope.
4. **No reference-data source.** `search_instruments` can't resolve names;
   `resolve_ticker` mints provisional refs. Acceptable for MVP only if the
   provisional status is surfaced to the user.
5. **Daily bars only.** "48 hrs" is two trading sessions, not 48 wall-clock
   hours. The agent must say so; `define_screener`'s response should carry
   the granularity so it can.

## Summary

| Tool | Source | Verdict |
|---|---|---|
| `search_catalog` | `webmcp/discovery` (unregistered) | Register; add enumerated-value listing |
| `search_instruments` | `webmcp/discovery` + `chart/tools/resolveTicker` | Merge; flag provisional results |
| `define_screener` | — | New; absorbs 5 screener tools' domain logic |
| `run_screener` | `webmcp/screener` (commented out) | Reuse |
| `get_screener_results` | `results/tools` (active) | Reuse; confirm `name` in projection |
| `create_panel` | `panels/tools` (active) | Reuse |
| `get_canvas_state` | `workbench/tools` (commented out) | Reuse; verify sources + runs reported |
| `remove_panel` | `panels/tools` (active) | Reuse |
| `set_panel_layout` | `panels/tools` (active) | Reuse |
