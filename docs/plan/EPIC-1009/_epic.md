# EPIC-1009: Screener Core

**Depends on**: EPIC-1006 (common contract: workspace/revision model,
stable IDs, mutation envelope, `expected_revision`, `idempotency_key`,
undo tokens, provenance type), EPIC-1008 (catalog registry of fields,
operators, studies, indicators, patterns, intervals, universes, and the
reference/fundamental market-data ports)
**Blocks**: EPIC-1010 (results surface — consumes this epic's pinned
`run_id`)
**Design**: docs/design/screener-core/

## Description

The app today ships an 11-tool pattern-research surface that answers
"where has this pattern happened before". It has no way to answer "which
instruments look like this right now". This epic delivers the screener
half of the WebMCP workbench described in `docs/reference/tool-spec.md`: six
tools that create a screener, choose its universe, build a nested filter
tree out of eight typed condition types, rank the matches, validate the
whole thing before it costs anything, and execute one specific screener
revision into a pinned `run_id`.

Everything lands in new files alongside the existing surface — the
current 11 tools, `src/lib/workspace/store.ts`, and the current UI are
not modified. EPIC-1015 retires them at the end of the program; `main`
stays deployable throughout.

## User Story

As an AI agent working alongside a human researcher,
I want to build, check, and run a typed stock screener through stable
tool calls,
so that the human and I are looking at the same defensible result set,
pinned to a revision and a data timestamp, instead of a screenshot of
numbers neither of us can reproduce.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1009-1 | Screener definition model and typed filter tree | — | Open |
| 2 | T-1009-2 | Screener execution contracts and run provenance | — | Open |
| 3 | T-1009-3 | `create_screener` and `set_screener_universe` tools | T-1009-1 | Open |
| 4 | T-1009-4 | `edit_filter_tree` structural operations | T-1009-1 | Open |
| 5 | T-1009-5 | `set_screener_ranking` tool | T-1009-1 | Open |
| 6 | T-1009-6 | Eight condition types with catalog validation | T-1009-4 | Open |
| 7 | T-1009-7 | Filter-tree evaluation engine | T-1009-2, T-1009-6 | Open |
| 8 | T-1009-8 | `validate_screener` tool | T-1009-2, T-1009-5, T-1009-6 | Open |
| 9 | T-1009-9 | `run_screener` with pinned run store | T-1009-7 | Open |
| 10 | T-1009-10 | Wire the six screener tools into the new WebMCP surface | T-1009-3, T-1009-8, T-1009-9 | Open |

## Dependency Graph

```
T-1009-1 ──┬──> T-1009-3 ──────────────────────────┬──> T-1009-10
           │                                        │
           ├──> T-1009-4 ──> T-1009-6 ──┬──> T-1009-7 ──> T-1009-9 ──┤
           │                             │                            │
           └──> T-1009-5 ────────────────┴──> T-1009-8 ───────────────┘
                                              ^
T-1009-2 ─────────────────────────────────────┴──> T-1009-7
```

## Wave Plan

- **Wave 1** (parallel): T-1009-1, T-1009-2 — the two model layers, no
  dependencies inside the epic.
- **Wave 2** (parallel): T-1009-3, T-1009-4, T-1009-5 — the three
  definition-editing tools, all on T-1009-1's model.
- **Wave 3**: T-1009-6 — the eight condition types, on T-1009-4's tree
  operations.
- **Wave 4** (parallel): T-1009-7, T-1009-8 — evaluation and validation.
- **Wave 5**: T-1009-9 — `run_screener` and the pinned run store.
- **Wave 6**: T-1009-10 — wiring and end-to-end integration.

## Acceptance Criteria

1. All six tools — `create_screener`, `set_screener_universe`,
   `edit_filter_tree`, `set_screener_ranking`, `validate_screener`,
   `run_screener` — are callable through the WebMCP surface and address
   every resource by stable ID.
2. Every mutating tool among them accepts `expected_revision` and
   `idempotency_key` and returns EPIC-1006's mutation envelope; a stale
   revision is rejected without mutating, and a replayed idempotency key
   returns the original result without acting twice.
3. `edit_filter_tree` supports add, update, remove, group, enable/disable,
   and reorder over arbitrarily nested `AND`, `OR`, and `NOT` groups,
   with node IDs that survive grouping and reordering.
4. All eight condition types from `docs/reference/tool-spec.md` — scalar,
   range, series comparison, temporal, event-relative, pattern, relative,
   and study output — can be expressed, are validated against EPIC-1008's
   catalog registry, and are rejected when they name unknown items or
   out-of-range parameters.
5. No filter condition accepts SQL, JavaScript, or any free-form
   expression that is parsed or evaluated — the model has no field
   capable of carrying one.
6. `validate_screener` reports invalid parameters, unavailable data,
   contradictory filters, expensive queries, and empty universes, and
   mutates nothing.
7. `run_screener` executes one named screener revision, returns a pinned
   `run_id`, and reports the screener revision executed, universe count,
   matched count, returned count, truncation, warnings, and full
   provenance (`as_of`, source, live/delayed, timezone, currency, price
   adjustment, fundamentals reporting period, calculation-engine version).
8. A completed run's stored results can be read back by `run_id` without
   re-executing the screener, and editing the screener afterwards does not
   change what that run describes.
9. Nothing in the existing 11-tool surface, `src/lib/workspace/store.ts`,
   or the current UI is modified; `main` remains deployable.
10. Every new module has tests alongside it (Vitest `*.test.ts`,
    `backend/tests/`), and the eight condition types each have at least
    one accept case and one reject case.

## Design References

- `docs/design/screener-core/spec.md` — behavioral spec for all six tools,
  scenario by scenario; the source of truth for every ticket's AC.
- `docs/design/screener-core/technical.md` — the screener definition
  shape, the filter-node and condition unions, and the pinned-run contract
  EPIC-1010 consumes.
- `docs/reference/tool-spec.md` — the program-level ~33-tool surface this
  epic implements six of, and the common contract every tool obeys.
- `src/lib/webmcp/tools.ts` and `src/lib/webmcp/types.ts` — the existing
  `ToolSpec` shape, `ok`/`fail` result helpers, and handle-based model to
  follow (not to modify).
- `backend/domain/contracts/engine.py` — the existing Protocol-in-domain,
  adapter-in-infra pattern the evaluation port follows.
- `backend/api/routes/research.py` — the existing FastAPI route, schema,
  and error-mapping conventions for networked tools.

## Out of Scope

- Reading, paging, selecting, explaining, or formatting results — that is
  EPIC-1010, which consumes this epic's `run_id`.
- The catalog registry and the reference/fundamental data pipeline behind
  it (EPIC-1008), and the workspace/revision/undo machinery (EPIC-1006).
- Backtesting, watchlist saving, exporting, and alerting on a screener.
- Deriving a filter tree from an example chart
  (`derive_filters_from_setup`) and computed/custom fields.
- Retiring the existing 11-tool surface — EPIC-1015.
- Any screener UI panel; this epic delivers the tool surface and its
  engine only.
