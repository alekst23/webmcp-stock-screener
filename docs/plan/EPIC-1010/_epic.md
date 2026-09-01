# EPIC-1010: Results & Explain

**Depends on**: EPIC-1006 (workspace/revision contract), EPIC-1007 (panel
container and panel-kind registry), EPIC-1009 (screeners and the pinned
`run_id`), EPIC-1008 (reference/fundamental data ports)
**Blocks**: EPIC-1015 (retirement of the legacy 11-tool surface)
**Design**: docs/design/results-and-explain/spec.md

## Description

Delivers the Results area of the new ~33-tool WebMCP surface described in
`.dev/design/tool-spec.md`: `configure_results_table`,
`get_screener_results`, `select_result`, and `explain_result`. Together
they turn a screener run from an opaque count into something a person and
an agent can read, page through, select from, and audit. The defining
guarantee of this epic is transparency: results are read from an
already-pinned `run_id` and are never silently recomputed, and
`explain_result` exposes the actual value and pass/fail state of *every*
filter plus each ranking field's contribution, so a screener's verdict on
any instrument is fully auditable.

All work lands in NEW files alongside the existing 11-tool pattern-research
surface. Nothing in `src/lib/webmcp/tools.ts`, `src/lib/workspace/store.ts`,
or the current UI is modified — `main` stays deployable throughout, and
EPIC-1015 retires the old surface at the end of the program.

## User Story

As a researcher (or the agent working alongside me),
I want to shape, page through, select from, and interrogate a screener
run's results,
so that I can see which instruments matched, look at any one of them on a
chart, and understand exactly why the screener did or did not pick it —
without re-running anything or trusting a number whose origin I can't see.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1010-1 | Results table configuration domain model and validation | — | Open |
| 2 | T-1010-2 | Bounded results page, provenance envelope, and pinned-run read contract | — | Open |
| 3 | T-1010-3 | Filter explanation and ranking contribution domain model | — | Open |
| 4 | T-1010-4 | Paged results projection use case (`get_screener_results`) | T-1010-1, T-1010-2 | Open |
| 5 | T-1010-5 | Result explanation use case (`explain_result`) | T-1010-2, T-1010-3 | Open |
| 6 | T-1010-6 | Table configuration and selection mutations (`configure_results_table`, `select_result`) | T-1010-1 | Open |
| 7 | T-1010-7 | `results_table` panel kind with selection and explain view | T-1010-4, T-1010-5, T-1010-6 | Open |
| 8 | T-1010-8 | WebMCP registration and end-to-end wiring for the four Results tools | T-1010-7 | Open |

## Dependency Graph

```
T-1010-1 ──┬──> T-1010-4 ──┐
           │               │
T-1010-2 ──┼──> T-1010-5 ──┼──> T-1010-7 ──> T-1010-8
           │               │
T-1010-3 ──┘               │
                           │
T-1010-1 ────> T-1010-6 ───┘
```

## Wave Plan

- **Wave 1** (parallel): T-1010-1, T-1010-2, T-1010-3 — pure domain
  models, no dependencies on each other.
- **Wave 2** (parallel): T-1010-4, T-1010-5, T-1010-6 — use cases over
  the Wave 1 models.
- **Wave 3**: T-1010-7 — the `results_table` panel kind and explain view.
- **Wave 4**: T-1010-8 — WebMCP tool registration and integration.

## Acceptance Criteria

1. `configure_results_table` sets a results panel's columns, computed
   columns, sort, grouping, conditional formatting, page size, and linked
   chart panel, and returns the common mutation envelope
   (`change_id`, `new_revision`, `affected_ids`, `diff_summary`,
   `warnings`, `undo_token`).
2. `get_screener_results` returns a bounded page of an existing run's
   results, with the total count and a next-page cursor, projected
   through the panel's configured columns and sort.
3. **No silent rerun**: `get_screener_results` and `explain_result` never
   execute a screener. Reading an expired or unknown `run_id` produces an
   explicit error naming the run and directing the caller to re-run,
   never an implicit execution. This is verified by a test that fails if
   the run-execution path is reached.
4. `select_result` sets a panel's selected results by stable result ID,
   propagates the selection to linked chart and details panels, rejects
   IDs that are not part of the run, and supports clearing the selection.
5. `explain_result` returns, for one instrument in a pinned run, every
   filter condition in the screener's filter tree — including conditions
   nested inside `AND`/`OR`/`NOT` groups — each with its operator,
   threshold, the instrument's actual value, and a pass / fail /
   indeterminate outcome, plus each group's resolved outcome.
6. `explain_result` returns each ranking field's raw value, normalized
   value, weight, and contribution to the final score, along with the
   instrument's rank in the run.
7. `explain_result` also explains an instrument that the run evaluated but
   rejected, and states that it is not among the results; an instrument
   outside the run's universe produces an explicit error rather than an
   empty explanation.
8. Every results page and every explanation states `as_of`, source,
   live/delayed status, timezone, currency, adjusted/unadjusted price
   policy, fundamentals reporting period, and calculation-engine version.
9. Every resource in every tool's input and output is addressed by a
   stable ID; a bare ticker never functions as an identifier.
10. Every mutation accepts `expected_revision` and `idempotency_key`;
    a stale revision is rejected without partial application, and a
    replayed `idempotency_key` returns the original result and mutates
    once.
11. A `results_table` panel kind is registered with EPIC-1007's panel
    registry and renders the configured columns, grouping, and conditional
    formatting, with the explanation reachable for any visible row.
12. The existing 11-tool pattern-research surface, `store.ts`, and the
    current UI are unchanged, and the app remains deployable.

## Design References

- `docs/design/results-and-explain/spec.md` — the behavioral spec this
  epic implements; every ticket's AC traces to a scenario in it.
- `.dev/design/tool-spec.md` — program-level design source of truth: the
  Results tool row definitions, the common mutation contract, and the
  market-data provenance requirement.
- `src/lib/webmcp/tools.ts` — existing tool-definition conventions
  (`ToolSpec`, `inputSchema`, `available`, `execute`, `ok`/`fail`) that
  the new tools follow. Not modified by this epic.
- `src/lib/webmcp/types.ts` — existing handle-based ID conventions.
- `backend/domain/`, `backend/application/`, `backend/infra/`,
  `backend/api/` — the layered structure new backend code follows;
  domain never imports from infra.

## Prerequisites Owned by Other Epics

These contracts are consumed, not built, here. If one is not yet
available when a ticket starts, code against the contract and use a local
test double — do not re-implement it.

| Contract | Owner |
|----------|-------|
| Workspace/revision model, stable IDs, mutation envelope, `expected_revision`, `idempotency_key`, undo tokens, provenance type | EPIC-1006 |
| Panel container, panel-kind registry, `link_panels` | EPIC-1007 |
| Catalog fields and instrument resolution; reference/fundamental data ports | EPIC-1008 |
| Screener definition, filter tree, ranking configuration, run execution and the pinned `run_id` | EPIC-1009 |

## Out of Scope

- Creating, editing, validating, or running screeners (EPIC-1009).
- The panel container, the panel-kind registry itself, and `link_panels`
  (EPIC-1007).
- The workspace/revision model, mutation envelope, and undo mechanics
  (EPIC-1006).
- Catalog and instrument discovery (EPIC-1008).
- Building a mock pipeline for reference/fundamental market data — that
  is a separate parallel workstream, consumed through EPIC-1008's ports.
- `export_results`, `save_results_to_watchlist`, `backtest_screener`, and
  alerting — later epics.
- Any modification to, or retirement of, the existing 11-tool
  pattern-research surface (EPIC-1015).

## Open Questions

Carried from `docs/design/results-and-explain/spec.md` — each has a stated
assumption that tickets proceed on.

1. Whether results-table configuration lives in EPIC-1006's workspace
   state (assumed: yes, panel-scoped) or elsewhere.
2. Pinned-run retention/expiry policy (assumed: runs may expire; expiry is
   an explicit error, never an implicit re-run).
3. Whether computed columns and sort are evaluated over the full result
   set or per page (assumed: full set, before paging).
4. Page size default and hard maximum (assumed: 25 default, 200 maximum).
5. Whether `explain_result` covers rejected candidates (assumed: yes, any
   instrument the run evaluated).
6. Whether EPIC-1009's ranking engine emits per-field contributions
   (assumed: yes; if not, this epic defines the contract and EPIC-1009
   fills it).
