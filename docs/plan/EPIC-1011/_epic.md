# EPIC-1011: Chart Tools

**Depends on**: EPIC-1006 (workspace/revision + mutation envelope), EPIC-1007 (panel container + panel-kind registry), EPIC-1008 (catalog registry)
**Blocks**: EPIC-1012 (similarity search consumes the captured-setup contract)
**Design**: docs/design/chart-tools/

## Description

The new WebMCP surface described in `docs/reference/tool-spec.md` gives an
agent a real chart to drive: it can set what the chart shows, put studies
on it, read a bounded slice of what is visible, mark it up, and capture
the whole configuration as a reusable reference setup. This epic
registers three `Chart` tools directly — `get_chart_data`,
`add_chart_annotation`, and `capture_chart_setup` — plus the `chart` panel
kind that renders their effect. What was `configure_chart`'s
instrument/timeframe/range/comparisons responsibility now folds into
EPIC-1007's `bind_panel_source` (a chart panel's source becomes an
instrument + timeframe + range reference); its candle
type/scale/session/price-adjustment-policy responsibility, and everything
`edit_chart_studies` did, folds into EPIC-1007's `configure_panel_view`.
This epic contributes the **chart-renderer contract** — the schema and
validation those two EPIC-1007 tools apply for a `chart`-rendered panel —
into EPIC-1007's source/renderer registry (T-1007-7), the same way
EPIC-1010 contributes the table-renderer contract. Everything is built
entirely in new files alongside the existing 11-tool pattern research
surface, which keeps working untouched.

Done looks like: an agent points a chart panel at an instrument via
`bind_panel_source`, adds an RSI and a 50/200 MA via `configure_panel_view`,
reads back 200 bars of OHLCV and study output with full provenance via
`get_chart_data`, marks the breakout with a trendline and a highlighted
window via `add_chart_annotation`, and captures the result as a reference
setup via `capture_chart_setup` that EPIC-1012's similarity search can
consume by ID.

## User Story

As a researcher working alongside an AI agent,
I want the agent to configure, annotate, and read a real chart the same
way I would,
so that we are looking at the same evidence and can hand a specific,
fully specified setup back and forth without describing it in prose.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1011-1 | Chart domain model, stable IDs, and captured-setup contract | — | Done |
| 2 | T-1011-2 | Study calculation engine with declared engine version | — | Done |
| 3 | T-1011-3 | Chart series port and market-data provenance envelope | — | Done |
| 4 | T-1011-4 | Chart source and view contract (symbol, timeframe, range, display settings) | T-1011-1, T-1011-3 | Done |
| 5 | T-1011-5 | Chart studies contract (add/update/reorder/toggle/remove) | T-1011-1, T-1011-2 | Done |
| 6 | T-1011-6 | `get_chart_data` bounded read | T-1011-1, T-1011-2, T-1011-3 | Done |
| 7 | T-1011-7 | `add_chart_annotation` tool | T-1011-1 | Done |
| 8 | T-1011-8 | `capture_chart_setup` tool | T-1011-4, T-1011-5, T-1011-7 | Done |
| 9 | T-1011-9 | Chart panel rendering, tool registration, and smoke | T-1011-4, T-1011-5, T-1011-6, T-1011-7, T-1011-8 | Done |

## Dependency Graph

```
T-1011-1 ──┬──> T-1011-4 ──┐
           ├──> T-1011-5 ──┤
           ├──> T-1011-6 ──┼──> T-1011-9
           └──> T-1011-7 ──┤
                           │
T-1011-2 ──┬──> T-1011-5   │
           └──> T-1011-6   │
                           │
T-1011-3 ──┬──> T-1011-4   │
           └──> T-1011-6   │
                           │
T-1011-4 ─┐                │
T-1011-5 ─┼──> T-1011-8 ───┘
T-1011-7 ─┘
```

## Wave Plan

- **Wave 1** (parallel): T-1011-1, T-1011-2, T-1011-3 — no dependencies
- **Wave 2** (parallel): T-1011-4, T-1011-5, T-1011-6, T-1011-7
- **Wave 3**: T-1011-8 — needs a configured chart with studies and annotations to capture
- **Wave 4**: T-1011-9 — renders and registers everything

## Prerequisites (owned by other epics — do not re-implement)

- **EPIC-1006** owns the workspace/revision model, the stable ID scheme,
  `expected_revision`, `idempotency_key`, the mutation result envelope
  (`change_id`, `new_revision`, `affected_ids`, `diff_summary`,
  `warnings`, `undo_token`), undo tokens, and the provenance type. Every
  chart mutation in this epic accepts and returns those; none of them are
  defined here.
- **EPIC-1007** owns the panel container, the panel-kind registry, and
  the source/renderer contract registry. The `chart` panel kind delivered
  by T-1011-9 plugs into the kind registry; this epic's chart-renderer
  contract (T-1011-4, T-1011-5) plugs into the source/renderer registry
  under the `chart` renderer name; panel creation, layout, linking, and
  removal, and the `bind_panel_source`/`configure_panel_view` tool calls
  themselves, are not in this epic.
- **EPIC-1008** owns the catalog registry. This epic's chart-studies
  contract (T-1011-5) resolves every study through the catalog
  (parameters, units, valid ranges, defaults, outputs, pane placement)
  rather than hard-coding a study list.

## Acceptance Criteria

1. All three directly-registered chart tools (`get_chart_data`,
   `add_chart_annotation`, `capture_chart_setup`) are registered on the
   new WebMCP surface and callable, and the chart-renderer contract is
   registered into EPIC-1007's source/renderer registry so
   `bind_panel_source` and `configure_panel_view` resolve to this epic's
   behavior for a `chart`-rendered panel — with the existing 11
   pattern-research tools still registered and working unchanged.
2. Every chart resource — panel, study instance, annotation, captured
   setup, instrument — is addressed by a stable ID. A bare ticker is
   never accepted as an identifier.
3. Every chart mutation accepts `expected_revision` and
   `idempotency_key` and returns EPIC-1006's mutation envelope, including
   an undo token that reverses the change.
4. Every market-data payload the chart tools return states `as_of`,
   source, live/delayed status, timezone, currency, the effective
   price-adjustment policy, the fundamentals reporting period where
   fundamentals are involved, and the calculation-engine version.
5. `get_chart_data` cannot return an unbounded series: a request with no
   bound, or one whose window exceeds the per-call bar cap, is refused
   with the cap, the number of bars available, and a concrete remedy —
   never silently truncated and never paged into an unbounded loop.
6. The price-adjustment policy (adjusted / split-adjusted / unadjusted)
   is settable on the chart, echoed in every data payload derived from
   it, and recorded in a captured setup.
7. Studies can be added, updated, reordered, toggled, and removed; a
   study instance keeps its ID across update, reorder, and toggle.
8. Annotations of all five kinds — trendline, price level, date range,
   label, highlighted setup window — can be added and are rendered on the
   chart panel.
9. `capture_chart_setup` produces a `CapturedChartSetup` record,
   addressable by a stable `setup_id`, that fully specifies instrument,
   window, timeframe, session, studies, normalization, and
   price-adjustment policy — sufficient for EPIC-1012's
   `find_similar_setups` to run from the ID alone.
10. Nothing under `src/lib/workspace/store.ts`, `src/lib/webmcp/tools.ts`,
    or the existing chart components is modified; `main` stays deployable
    at every ticket boundary.

## Design References

- `docs/reference/tool-spec.md` — the program's tool surface; the `Chart`
  rows and the "Common contract for every tool" section are this epic's
  source requirements
- `docs/design/chart-tools/spec.md` — behavioral spec for this feature
- `docs/design/chart-tools/technical.md` — contracts, including the
  cross-epic `CapturedChartSetup`
- `src/lib/workspace/visualization.ts` — existing pure chart-geometry
  functions (scales, paths, axis ticks, nearest-bar hit testing) whose
  technique T-1011-9 duplicates into new files
- `src/lib/workspace/PriceChart.svelte`, `FocusChart.svelte`,
  `ChartToolbar.svelte` — existing SVG chart rendering conventions to
  follow
- `src/lib/webmcp/tools.ts` — existing `ToolSpec` / `ToolResult` shape
  and the `ok`/`fail`/`run` result conventions

## Open Questions

1. **Wire-format casing.** `docs/reference/tool-spec.md` names envelope
   fields in `snake_case` (`expected_revision`, `change_id`, `as_of`);
   the existing tool surface uses `camelCase` on the wire. This epic
   assumes `snake_case` on the wire for every field the spec names
   explicitly, `camelCase` for TypeScript identifiers. **EPIC-1006 is
   authoritative** — if it standardizes differently, chart tools follow
   it, and this is a mechanical rename inside new files.
2. **Who owns the OHLCV bars port.** EPIC-1008 owns the catalog and the
   reference/fundamental data ports. It is not settled whether the price
   *bar* series port belongs there or here. Assumption: T-1011-3 declares
   a narrow `ChartSeriesPort` in this epic's domain layer; if the
   market-data workstream publishes an equivalent port, T-1011-3's port
   becomes a type alias to it rather than a second implementation.
3. **Per-call bar cap value.** No number is given in the spec. Assumption:
   500 bars per `get_chart_data` call, as a named constant that
   `get_app_context` can surface, chosen so a full year of daily bars
   fits in two calls.

## Out of Scope

- Panel creation, layout, linking, and removal (EPIC-1007).
- The catalog itself — study definitions, parameter metadata, and
  availability (EPIC-1008).
- Similarity search, similarity explanation, and setup comparison
  (EPIC-1012) — this epic only produces the captured setup they consume.
- Custom user-defined studies (`create_custom_study` is a follow-up tool
  in the spec, not a core tool).
- Backtesting, alerts, watchlists, and export.
- Retiring the existing 11-tool surface (EPIC-1015).
- Building a market-data pipeline — bars and reference data arrive
  through ports; the pipeline is a separate parallel workstream.
