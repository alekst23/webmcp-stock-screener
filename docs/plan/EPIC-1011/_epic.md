# EPIC-1011: Chart Tools

**Depends on**: EPIC-1006 (workspace/revision + mutation envelope), EPIC-1007 (panel container + panel-kind registry), EPIC-1008 (catalog registry)
**Blocks**: EPIC-1012 (similarity search consumes the captured-setup contract)
**Design**: docs/design/chart-tools/

## Description

The new WebMCP surface described in `.dev/design/tool-spec.md` gives an
agent a real chart to drive: it can set what the chart shows, put studies
on it, read a bounded slice of what is visible, mark it up, and capture
the whole configuration as a reusable reference setup. This epic delivers
the five `Chart` tools from that spec — `configure_chart`,
`edit_chart_studies`, `get_chart_data`, `add_chart_annotation`, and
`capture_chart_setup` — plus the `chart` panel kind that renders their
effect, entirely in new files alongside the existing 11-tool pattern
research surface, which keeps working untouched.

Done looks like: an agent configures a chart panel by instrument ID,
adds an RSI and a 50/200 MA, reads back 200 bars of OHLCV and study
output with full provenance, marks the breakout with a trendline and a
highlighted window, and captures the result as a reference setup that
EPIC-1012's similarity search can consume by ID.

## User Story

As a researcher working alongside an AI agent,
I want the agent to configure, annotate, and read a real chart the same
way I would,
so that we are looking at the same evidence and can hand a specific,
fully specified setup back and forth without describing it in prose.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1011-1 | Chart domain model, stable IDs, and captured-setup contract | — | Open |
| 2 | T-1011-2 | Study calculation engine with declared engine version | — | Open |
| 3 | T-1011-3 | Chart series port and market-data provenance envelope | — | Open |
| 4 | T-1011-4 | `configure_chart` tool | T-1011-1, T-1011-3 | Open |
| 5 | T-1011-5 | `edit_chart_studies` tool | T-1011-1, T-1011-2 | Open |
| 6 | T-1011-6 | `get_chart_data` bounded read | T-1011-1, T-1011-2, T-1011-3 | Open |
| 7 | T-1011-7 | `add_chart_annotation` tool | T-1011-1 | Open |
| 8 | T-1011-8 | `capture_chart_setup` tool | T-1011-4, T-1011-5, T-1011-7 | Open |
| 9 | T-1011-9 | Chart panel rendering, tool registration, and smoke | T-1011-4, T-1011-5, T-1011-6, T-1011-7, T-1011-8 | Open |

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
- **EPIC-1007** owns the panel container and the panel-kind registry.
  The `chart` panel kind delivered by T-1011-9 plugs into that registry;
  panel creation, layout, linking, and removal are not in this epic.
- **EPIC-1008** owns the catalog registry. `edit_chart_studies` resolves
  every study through the catalog (parameters, units, valid ranges,
  defaults, outputs, pane placement) rather than hard-coding a study list
  in the tool.

## Acceptance Criteria

1. All five chart tools are registered on the new WebMCP surface and
   callable, with the existing 11 pattern-research tools still registered
   and working unchanged.
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

- `.dev/design/tool-spec.md` — the program's tool surface; the `Chart`
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

1. **Wire-format casing.** `.dev/design/tool-spec.md` names envelope
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
