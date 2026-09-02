# T-1011-9: Chart panel rendering, tool registration, and smoke

**Epic**: EPIC-1011 (Chart Tools)
**Design**: docs/design/chart-tools/
**Status**: Open
**Depends on**: T-1011-4, T-1011-5, T-1011-6, T-1011-7, T-1011-8
**Blocks**: —

## Description

The preceding tickets produce chart state and five tools that change it,
but nothing on screen and nothing registered. This ticket delivers the
`chart` panel kind that renders that state into EPIC-1007's panel
registry, registers all five tools on the new WebMCP surface, and proves
the whole path works against a running app.

## User Story

As a researcher watching an agent work,
I want the chart to visibly change the moment the agent configures it,
adds a study, or draws a trendline,
so that the tool calls are something I can see and trust rather than
claims in a transcript.

## Acceptance Criteria

1. A `chart` panel kind is registered in EPIC-1007's panel-kind registry
   and renders a chart panel from chart state alone.
2. The panel renders price in each supported candle type, honours the
   selected price scale, and shows the visible range's date axis and
   price axis.
3. Enabled studies are drawn where the catalog places them — overlaid on
   price or in their own sub-pane — in the order the study list defines,
   and a toggled-off study disappears without losing its place.
4. All five annotation kinds are drawn on the panel at their anchors, and
   an annotation flagged stale by an adjustment-policy change is visibly
   distinguished from a current one.
5. Comparison instruments are drawn using the configured normalization
   mode, on a shared scale that makes the comparison meaningful.
6. The panel displays the effective price-adjustment policy and the
   data's as-of time and live/delayed status, so a human can see the same
   provenance the agent receives.
7. All five chart tools are constructed once at the application's
   composition root and registered on the new WebMCP surface; no tool is
   constructed a second time in a lower layer.
8. The existing 11 pattern-research tools remain registered and working,
   and no file under `src/lib/workspace/store.ts`, `src/lib/webmcp/tools.ts`,
   or the existing chart components has been modified by this epic.
9. Live smoke, with the app running: configure a chart to a real
   instrument and timeframe, add a moving average and an RSI, read a
   bounded window back, add a trendline and a highlighted window, and
   capture the setup — observing on screen that the chart shows the
   instrument, both studies, and both annotations, and that the captured
   setup is retrievable by its returned ID.
10. Undoing each of the smoke run's mutations with its returned undo
    token restores the previously rendered chart.

## Solution Approach

### Shape

Two new directories under `src/lib/workbench/chart/`, plus one composition
root. Nothing outside `src/lib/workbench/chart/` is modified.

```
chart/components/chartScales.ts        pure geometry: price scale (linear/log),
                                       time scale, axis ticks, candle shapes
chart/components/chartPanelModel.ts    pure assembly: chart state + a bounded
                                       read -> everything the panel draws
chart/components/ChartPanel.svelte     the `chart` panel kind, runes mode
chart/tools/index.ts                   buildChartTools + operation registration
                                       + the composed renderer contract
chart/tools/registerChartTools.ts      composition root, feature-flagged
```

### Rendering reads state, never guesses it

`ChartPanel.svelte` takes `{ document, panelId, data, comparisons }`. Config,
studies and annotations come from `readChartState(document, panelId)` and
`readChartAnnotationsView(document, panelId)` — the latter because staleness
is computed in exactly one place and the panel must not compute a second
answer. Bars, studies' calculated outputs and provenance come from a
`ChartDataResult`, which is what `get_chart_data` already returns: the panel
and the agent therefore see the same numbers and the same provenance (AC6).

`chartScales.ts` duplicates the technique of `src/lib/workspace/visualization.ts`
rather than importing it: that module is typed against `BackendPriceBar` and
serves the surface EPIC-1015 retires. The new module works on `OhlcvBar`,
adds a logarithmic price scale (AC2), and derives per-bar candle geometry for
all six candle types — `heikin_ashi` as a pure bar transform ahead of the
same geometry, `hollow_candle` as a fill rule rather than a second shape.

`chartPanelModel.ts` folds state and data into one render model: the price
pane's marks, the price-overlay studies in list order, one sub-pane per
sub-pane study in list order (a disabled study contributes no pane but keeps
its place in the ordered list the model exposes, AC3), the five annotation
kinds resolved to x/y in the price pane's space with their `stale` flag
carried through (AC4), and comparison series normalized under each
comparison's own mode onto the primary series' scale (AC5).

### Normalization puts comparisons on a shared scale

`none` draws the comparison on its own scale mapped onto the price pane;
`percent_change` and `indexed_100` rebase both series at the anchor bar so
one axis is meaningful for both; `z_score` standardizes each series. The
normalized primary series is what the comparison is drawn against, so the two
are always on the same axis rather than two invisible ones.

### One construction site

`buildChartTools(deps)` constructs `get_chart_data`, `add_chart_annotation`
and `capture_chart_setup` once each and returns them. It also calls
`registerChartOperations(deps.registry, deps)` first, so all five operation
kinds (`chart.bind_source`, `chart.configure_view`, `chart.edit_studies`,
`chart.add_annotation`, `chart.capture_setup`) exist before any tool factory
runs — the tool factories' own `ensure*` calls then find them already there
and register nothing (AC7). Registration is guarded on `registry.get(kind)`
because the registry rejects a duplicate kind outright.

`registerChartTools.ts` mirrors `registerWorkbenchTools.ts`: a
`CHART_TOOLS_ENABLED` flag that stays `false`, a `createDefaultChartDeps()`
that wires the local workspace repository, an in-memory series port and a
shared `IdSequencer` seeded from **both** `chartStateIdSeed(doc)` and
`capturedSetupIdSeed(doc)` of the active document, so a reloaded workspace
never re-mints a live `study_N`, `annotation_N` or `setup_N`.

### The renderer contract is composed, not registered twice

`chartRendererTypeDefinition` (T-1011-4) is the base; `composeRendererWithStudies`
(T-1011-5) folds the study-editing half into it. `registerChartPanelContract`
is the single call site: it registers the chart source type and the *composed*
renderer against a structurally-declared `PanelContractRegistry`. Nothing is
imported from EPIC-1007.

### AC9/AC10 — manual browser verification is deferred

A live browser smoke is not achievable in this ticket. The new surface is
behind `CHART_TOOLS_ENABLED = false` and is deliberately not wired into any
route: EPIC-1007 owns panel creation and layout, and its panel registry is
not on `main`, so there is no route that can create a `chart` panel to look
at. Flipping the flag early would put an unfinished surface into the shipping
runtime path, which the project's dead-code policy forbids.

The AC is therefore met by an automated end-to-end integration test —
`chartSurface.smoke.test.ts` — that drives the whole epic against a real
repository, revision service, operation registry and
`createInMemoryChartSeries`: bind an instrument and timeframe, add a moving
average and an RSI, read a bounded window back through `get_chart_data`, add
a trendline and a highlighted setup window, capture the setup, retrieve it by
its returned ID, render `ChartPanel.svelte` against that final state in jsdom
and assert the instrument, both studies and both annotations are in the DOM,
then undo every mutation with its own returned undo token and assert the
prior state is restored (AC10). Manual browser verification is deferred to
the ticket that first mounts a chart panel in a route.

## Design References

- `docs/design/chart-tools/spec.md` — every behavioral section; this
  ticket is where they become observable
- `docs/design/chart-tools/technical.md` — component and process
  topology
- `src/lib/workspace/PriceChart.svelte` — existing SVG chart body,
  gradient fill, hover crosshair and tooltip conventions
- `src/lib/workspace/FocusChart.svelte`, `ChartToolbar.svelte` — existing
  chart panel composition and human-action recording conventions
- `src/lib/workspace/visualization.ts` — pure geometry functions
  (`computeChartGeometry`, `axisTicks`, `axisTickIndices`,
  `nearestBarIndex`) whose technique this ticket duplicates into new
  files for the new panel
- `src/lib/webmcp/register.ts` — how tools are registered against the
  WebMCP session today

## Technical Considerations

- Duplicate, do not reuse-by-modification: the existing chart components
  keep serving the old surface untouched until EPIC-1015 retires it.
  Copying the geometry technique into new files is the intended cost of
  the full-replacement strategy.
- Everything in this epic runs in the browser process; there is no
  cross-process channel. State reaches the panel through the workspace
  store EPIC-1006 defines, and the tools mutate that same store, so the
  panel re-renders reactively rather than being pushed to.
- If any placeholder types were declared while EPIC-1006's contracts were
  in flight, replace them with the real ones here — this is the last
  ticket that can do so before the epic closes.

## Out of Scope

- Panel creation, layout, and linking UI (EPIC-1007).
- Retiring the existing surface (EPIC-1015).
- Chart interactions a human performs by mouse beyond hover readout —
  drawing tools, drag-to-zoom, and pan are not in this epic's tool set.
