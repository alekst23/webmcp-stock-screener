# Tool Surface MVP

The minimum set of WebMCP tools an agent needs to serve the MVP use case
correctly, derived from the use case forward — "what does the agent need to
do?" — not from the existing inventory backward. Overlap with existing tools
is recorded per tool, but reuse is never the reason a tool is on the list.

Companion to [Tool Surface Status](tool-surface-status.md) (what's registered
today).

## The use case

1. User: **"Find energy sector stocks with highest gains in the past 48 hrs."**
   The agent builds a screener; the user sees its settings in a screener
   widget and its results in a list.
2. User: **"Make charts from the top 5"** / **"show me X and Y"** — or drags a
   row from the list onto the canvas. Chart panels appear, one per instrument.

Follow-ups the MVP must not fall over on: "make it top 20" (re-run updates
the same list), "only ones above $10", "close those charts", "what's on
screen?".

## How data travels

```
screener definition ──(live)──► results list ──(copy-out)──► charts
      in the doc                  bound to run_id              each holds its own instrument ref
```

- **Screener → list is the only live link.** `define_screener` writes the
  definition to the workspace document; `run_screener` pins a run and rebinds
  the *same* `results_table` panel to the new `run_id`. Re-run → same panel,
  new rows.
- **List → chart is a copy-out, not a link.** A chart panel's source is
  `{ type: 'instrument', ref }`: self-contained, durable in the document, and
  independent of the list afterwards. Re-running the screener changes the
  list and leaves every chart exactly as it was. A chart made from the list is
  indistinguishable from one made any other way.
- **Two ways to copy out, one use case.** Agent: `get_screener_results` → refs
  → `create_panel(chart, instrument)` per instrument. Human: drag a row onto
  an empty cell (creates a chart) or onto an empty chart box (binds it). Both
  end in the same `createPanel`/`bindPanelSource` use case.
- **Evaluation happens server-side; the browser owns the pin.** The
  frontend's `ScreenerEvaluationPort.execute` becomes an HTTP call whose
  response is shaped into a `ScreenerRun` and pinned in the in-memory
  `PinnedRunStore` exactly as today. The server stays stateless; runs don't
  survive a refresh (accepted for MVP).

## What the agent must be able to do

| # | Capability | Why it's required for correctness |
|---|---|---|
| A | Look up the engine's vocabulary (fields, operators, sector values, intervals) | "Energy sector" and "gains over 48 hrs" must map to ids the engine actually has. A guessed `field.change_48h` is a confident wrong answer, not an error. |
| B | Define a screener — universe, conditions, ranking, limit — **atomically**, validated in the same step | A screener half-built across four calls has intermediate states a run could observe. Validation must report *every* problem or the agent loops. |
| C | Execute and get a pinned, immutable run with provenance | "Past 48 hrs" is only a correct answer alongside `as_of`, delayed/live, and `truncated`. Later edits never change what a run says. |
| D | Read the run's rows with a **full instrument ref** and the ranking values | The agent says "XOM +4.2%" and then creates a chart from the row. The ref must be complete enough to bind a chart without a second lookup. |
| E | See results in the list, settings in the screener widget | If the agent claims a result or a setting the user can't see, that's a correctness failure. |
| F | Create a chart panel for an instrument | "Make charts from the top 5." |
| G | See the canvas: panel ids, kinds, sources, positions | Every follow-up needs panel ids; the agent verifies its own action landed before saying it did. |
| H | Remove a panel | "Close those charts." |

## The tools

### Core (7)

**1. `search_catalog`** — Capability A. Text/tag search over fields,
operators, studies, indicators, intervals, universes; returns id, kind,
label, parameter schema, and — *required addition* — the accepted values of
enumerated fields like `field.sector`.
Overlap: `webmcp/discovery/searchCatalog.ts` exists, registered nowhere,
does not enumerate sector values. **Register + extend.**

**2. `define_screener`** — Capability B. One payload: `universe` (asset
class, sectors, exchanges, indexes, liquidity floors, exclusions),
`conditions` (catalog-validated filter tree), `ranking` (fields, weights,
direction, tie-break), `limit`. Creates the screener or, given
`screener_id`, replaces its definition as a new revision. Full-replace, not
patch. Rejects unknown catalog ids, out-of-range parameters, and an empty
universe, reporting all problems together. States data granularity when a
time-based request is approximated (daily bars → "48 hrs" ≈ 2 sessions).
Overlap: replaces `create_screener`, `set_screener_universe`,
`edit_filter_tree`, `set_screener_ranking`, `validate_screener`. Their
domain logic is reusable; their tool boundaries are not. **New tool.**

**3. `run_screener`** — Capability C + E. Executes one screener revision via
the evaluation port, pins the result under a `run_id`, binds the workspace's
results table panel to it (creating one if none exists), returns the
`panel_id`. Response carries `as_of`, live/delayed, counts, `truncated`,
`ranking_applied`. An empty universe is a refusal with reason, never an empty
success.
Overlap: `webmcp/screener/runScreener.ts` (commented out) already does the
pin + auto-bind. **Reuse as-is.**

**4. `get_screener_results`** — Capability D. A page of rows for a `run_id`:
full instrument ref (`instrument_id`, `symbol`, `exchange`, `asset_type`,
`name`), every ranking value, provenance, cursor. Read-only.
Overlap: `results/tools/resultsTools.ts` (active). `ScreenerMatch`
(`screener/run.ts:80`) carries only `instrumentId` today. **Reuse; extend
the row to a full ref** so a chart can be created from it directly.

**5. `create_panel`** — Capability F. Creates a panel of a kind with an
initial source and renderer, auto-placed in the first free cell. For the use
case: `kind: 'chart'`, `source: { type: 'instrument', ref }`.
Overlap: `panels/tools/lifecycleTools.ts` (active). **Reuse as-is.**

**6. `get_canvas_state`** — Capability G. Every panel: id, kind, title,
source, renderer, rect; the active workspace id; pinned run ids.
Overlap: `workbench/tools/index.ts` (commented out). **Reuse; verify** it
reports sources and runs, not just geometry.

**7. `remove_panel`** — Capability H. By stable panel id.
Overlap: `panels/tools/lifecycleTools.ts` (active). **Reuse as-is.**

### Optional (2)

**`set_panel_layout`** — tidy "top 5" into a row. Batch of `{ panel_id, rect }`
applied atomically. Active today; harmless to leave registered.

**`search_instruments`** — only if "chart Exxon" (an instrument *not* in the
list) is in scope. Must never invent an instrument; a provisional reference
(no reference-data source exists) must carry `provisional: true`.
Overlap: `webmcp/discovery/searchInstruments.ts` (honest-unavailable,
unregistered) and `chart/tools/resolveTicker.ts` (registered; mints
provisional refs). One capability split into two tools by circumstance —
merge if kept.

## Deliberately absent

| Existing tool | Why it's not needed |
|---|---|
| `create_screener`, `set_screener_universe`, `edit_filter_tree`, `set_screener_ranking`, `validate_screener` | Folded into `define_screener`. Four sequential mutations for one sentence is where correctness goes to die. |
| `resolve_ticker` | Results rows carry a full ref, so the core loop never needs to mint one. Folds into `search_instruments` if that's kept. |
| `set_panel_selection`, `link_panels`, `unlink_panels` | List → chart is a copy-out, not a live link. Selection stays a human UI affordance. |
| `split_panel`, `apply_layout_template`, `duplicate_panel`, `maximize_panel` | Expressible via `create_panel` + `set_panel_layout`, or client-only UI state. |
| `bind_panel_source`, `set_panel_renderer`, `configure_chart_grid`, `configure_panel_view` | Mutate-in-place config. MVP creates with the right source and defaults; recreate if it changes. (`bind_panel_source`'s *use case* is still what drag-onto-empty-chart calls — the tool isn't.) |
| `explain_result` | Correct and valuable; "why is X in the list?" is not in the use case. First candidate after MVP. |
| `describe_catalog_item` | `search_catalog` returns the schema inline. |
| Workspace lifecycle/safety (`create_workspace`, `save_workspace`, `undo_change`, `get_change_history`, `restore_workspace_revision`, `preview_workspace_changes`, `apply_previewed_changes`), `get_app_context` | Not exercised by the use case. |
| Chart authoring, similarity, follow-up, watchlist, alerts, backtest, export | Other features. |

## Gaps no tool list fixes

1. **No screener evaluation is wired.** Every real evaluation refuses with
   `empty_universe` (`workbenchCompositionRoot.ts:108-112`). Resolved by
   evaluating server-side: the backend already has a filter-tree evaluator
   (`backend/domain/filter_evaluation.py`, no caller) and the price panel; the
   frontend already has the `ScreenerEvaluationPort { validate, execute }`
   seam and an injection point (`WorkbenchCompositionOverrides.evaluationPort`).
   Missing: one endpoint and one HTTP port implementation.
2. **No "percent change over N sessions" field.** The catalog has
   `field.price.close` and `indicator.gap_percent` (single session), nothing
   that ranks "gain over the past 48 hrs". Needs `field.price.change_pct`
   with a `lookback_sessions` parameter — a window over the panel, computed
   server-side.
3. **Sector isn't plumbed to the frontend.** The backend holds `sector` and
   `market_cap` per ticker as static metadata (`backend/domain/models/universe.py`,
   loaded by `scripts/load_universe_metadata.py`); the frontend's instrument
   directory is the honest-unavailable stub and `InstrumentQuery` has no
   sector field. With server-side evaluation this becomes a backend universe
   filter; the frontend only needs the sector *values* for `search_catalog`.
   Fundamentals (P/E, revenue) have no source at all (`NoFundamentalsPort`)
   and are out of MVP scope.
4. **Results rows lack a full instrument ref** (see tool 4). Symbol and
   exchange are derivable from `inst:<MIC>:<SYMBOL>`; `asset_type` is assumed
   equity. Make the row carry the ref rather than every consumer deriving it.
5. **The screener widget is a placeholder.** The default workspace seeds one
   panel, `filter_builder` (`panelController.ts:124`), with no body. It needs a
   read-only body rendering the definition from `readScreeners(doc)`.
6. **No drag-and-drop exists in the shell.** The human copy-out path is new UI
   work: drag a results row onto an empty cell (create chart) or an empty
   chart panel (bind).
7. **Daily bars only.** "48 hrs" is two trading sessions. `define_screener`'s
   response carries the granularity so the agent can say so.

## Work breakdown

Three issues, independently buildable and testable, mergeable in any order.

### Issue 1 — Server-side screener run (backend)

`POST /screener/run` takes a screener definition, narrows the universe using
the loaded metadata (sector, market cap), resolves fields over the price panel
— including the new `field.price.change_pct(lookback_sessions)` — evaluates
the filter tree with the existing evaluator, ranks, and returns a bounded
result set: full instrument ref per row, ranking values, per-node pass/fail,
`as_of`, provenance, counts, `truncated`. `dry_run: true` validates without
executing, reporting every problem together. Stateless.
Closes gaps 1 (server half), 2, 3 (backend half).

### Issue 2 — Agent screener loop (frontend tools)

- `HttpScreenerEvaluationPort` implementing the existing port against
  Issue 1's endpoint, wired as the composition-root default. Tested through
  the existing `evaluationPort` seam with a fake, so it doesn't wait on
  Issue 1.
- `define_screener` absorbing the five screener tools' domain logic.
- `search_catalog` registered, with enumerated `field.sector` values.
- `ScreenerMatch` / `get_screener_results` rows carry a full instrument ref.
- Composition root registers exactly the core seven (plus optional two if
  wanted); everything else removed from the root, not commented. Verify
  `get_canvas_state` reports sources and runs. In-browser screener engine
  deleted if nothing but tests still needs it. `tool-surface-status.md`
  updated.
Closes gaps 1 (frontend half), 3 (frontend half), 4, 7.

### Issue 3 — Screener widget, seed layout, drag-to-chart (frontend UI)

- Read-only `filter_builder` body rendering the active screener definition
  (universe, conditions, ranking, limit) and re-rendering on notify.
- Seed layout: screener widget left, results list right, empty grid below.
- Drag a results row onto an empty cell → `createPanel(chart, instrument)`;
  onto an empty chart panel → `bindPanelSource`. Same use cases the agent
  tools call.
Depends only on the document shape, which already exists (`readScreeners`),
so it doesn't wait on Issue 1 or 2. Closes gaps 5, 6.

## Summary

| Tool | Source | Verdict |
|---|---|---|
| `search_catalog` | `webmcp/discovery` (unregistered) | Register; add enumerated values |
| `define_screener` | — | New; absorbs 5 screener tools |
| `run_screener` | `webmcp/screener` (commented out) | Reuse |
| `get_screener_results` | `results/tools` (active) | Reuse; row carries full ref |
| `create_panel` | `panels/tools` (active) | Reuse |
| `get_canvas_state` | `workbench/tools` (commented out) | Reuse; verify sources + runs |
| `remove_panel` | `panels/tools` (active) | Reuse |
| `set_panel_layout` (optional) | `panels/tools` (active) | Reuse |
| `search_instruments` (optional) | `webmcp/discovery` + `resolveTicker` | Merge; flag provisional |
