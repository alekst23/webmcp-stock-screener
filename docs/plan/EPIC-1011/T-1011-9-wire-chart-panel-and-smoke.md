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
