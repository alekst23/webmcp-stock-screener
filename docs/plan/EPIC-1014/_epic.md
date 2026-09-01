# EPIC-1014: High-Value Follow-Up Tools

**Depends on**: EPIC-1006, EPIC-1007, EPIC-1008, EPIC-1009, EPIC-1010,
EPIC-1011, EPIC-1012
**Blocks**: EPIC-1015 (legacy surface cutover)
**Issue**: —
**Design**: docs/design/screener-followup-tools/spec.md

## Description

The core epics (EPIC-1006 through EPIC-1012) give an agent a screener it
can build, run, read, chart, and search for lookalikes. This epic adds
the 13 follow-up tools from `.dev/design/tool-spec.md`'s "High-value
follow-up tools" section — the ones that turn a one-off screen into
durable research: refining a similarity search from feedback, authoring
computed fields and custom studies through a typed expression model,
deriving a draft filter tree from an example chart, backtesting a
screener with explicit survivorship assumptions, saving results into
watchlists, drafting alerts behind a human review gate, and exporting a
pinned run with full provenance.

This is the last implementation wave before cutover. Every tool here is
built in new files against the contracts the core epics define — no
re-implementation of the mutation envelope, the panel registry, the
catalog registry, the filter tree, pinned runs, captured setups, or the
similarity feature model.

Two safety properties are load-bearing and are not negotiable at
implementation time:

1. **No arbitrary code execution.** Computed fields and custom studies
   are authored as typed, validated expression trees over a permitted
   catalog of fields and functions. There is no SQL string, no
   JavaScript evaluation, and no DOM automation anywhere in this epic.
2. **No silently armed alerts.** An agent can draft and preview an
   alert. It cannot arm one. Activation requires an explicit human
   confirmation in the app's own alerts surface.

## User Story

As a researcher working with an AI agent on a screener,
I want the agent to be able to refine, author, backtest, save, watch, and
export the work we have built together,
so that a promising screen becomes a durable, reproducible,
provenance-carrying artifact instead of a result set I lose when I
reload — while keeping arbitrary code execution and alert activation
firmly out of the agent's hands.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1014-1 | Typed expression model and validator | — | Open |
| 2 | T-1014-2 | Computed fields and custom studies | T-1014-1 | Open |
| 3 | T-1014-3 | Derive a draft filter tree from a captured setup | — | Open |
| 4 | T-1014-4 | Similarity refinement from accepted and rejected matches | — | Open |
| 5 | T-1014-5 | Backtest evaluation engine | — | Open |
| 6 | T-1014-6 | Backtest tools | T-1014-5 | Open |
| 7 | T-1014-7 | Watchlists | — | Open |
| 8 | T-1014-8 | Alert draft and preview | — | Open |
| 9 | T-1014-9 | Native alert review gate | T-1014-8 | Open |
| 10 | T-1014-10 | Export a pinned run with provenance | — | Open |
| 11 | T-1014-11 | Register and integrate the follow-up tool surface | T-1014-2, T-1014-3, T-1014-4, T-1014-6, T-1014-7, T-1014-9, T-1014-10 | Open |

Tool coverage by ticket:

| Ticket | Tools delivered |
|--------|-----------------|
| T-1014-2 | `create_computed_field`, `create_custom_study` |
| T-1014-3 | `derive_filters_from_setup` |
| T-1014-4 | `refine_similarity_search` |
| T-1014-6 | `backtest_screener`, `get_backtest_results` |
| T-1014-7 | `upsert_watchlist`, `save_results_to_watchlist` |
| T-1014-8 | `create_alert_draft`, `preview_alert` |
| T-1014-9 | `enable_alert`, `disable_alert` |
| T-1014-10 | `export_results` |

## Dependency Graph

```
T-1014-1 ──> T-1014-2 ──┐
                        │
T-1014-3 ───────────────┤
                        │
T-1014-4 ───────────────┤
                        │
T-1014-5 ──> T-1014-6 ──┼──> T-1014-11
                        │
T-1014-7 ───────────────┤
                        │
T-1014-8 ──> T-1014-9 ──┤
                        │
T-1014-10 ──────────────┘
```

## Wave Plan

- **Wave 1** (parallel): T-1014-1, T-1014-3, T-1014-4, T-1014-5,
  T-1014-7, T-1014-8, T-1014-10 — each depends only on core-epic
  contracts, not on each other.
- **Wave 2** (parallel): T-1014-2, T-1014-6, T-1014-9 — each layers a
  tool surface onto its Wave 1 foundation.
- **Wave 3**: T-1014-11 — registers the whole follow-up surface and
  proves the end-to-end flows.

## Acceptance Criteria

1. All 13 follow-up tools named in `.dev/design/tool-spec.md` are
   registered on the new WebMCP surface, discoverable with descriptions
   and input schemas, and callable end to end.
2. Every mutating tool in this epic accepts `expected_revision` and
   `idempotency_key` and returns the common envelope (`change_id`,
   `new_revision`, `affected_ids`, `diff_summary`, `warnings`,
   `undo_token`); a stale `expected_revision` is rejected without
   mutating, and a repeated `idempotency_key` returns the original
   result without applying the change twice.
3. Every mutation created by this epic is reversible through EPIC-1006's
   `undo_change` using the returned `undo_token`.
4. No tool in this epic accepts or evaluates SQL, JavaScript, or any
   free-form executable string. Computed fields and custom studies are
   rejected with an actionable error when they reference a field,
   function, or type outside the permitted catalog.
5. An alert cannot reach an armed state through any sequence of tool
   calls alone. Arming requires a human confirmation performed in the
   app's own alerts surface, and the alert's state is visible there at
   all times.
6. `derive_filters_from_setup` produces a **draft** filter tree that is
   not applied to any live screener until a separate, explicit accept
   step applies it.
7. Backtest results state their survivorship assumption explicitly,
   along with the universe, date range, forward-return horizons, and the
   calculation-engine version used.
8. Every result carrying market data — backtest results, watchlist
   snapshots, and exports — states `as_of`, source, live/delayed status,
   timezone, currency, price adjustment policy, fundamentals reporting
   period where applicable, and calculation-engine version.
9. An export of a pinned run reproduces the run's filters, ranking,
   universe, `run_id`, timestamp, and the provenance envelope above;
   exporting never silently reruns the screener.
10. Every resource this epic creates — computed fields, custom studies,
    draft filter trees, backtests, watchlists, alerts, exports — has a
    stable ID that later tool calls address it by.
11. The legacy 11-tool pattern-research surface, `src/lib/workspace/`,
    and the current UI are unmodified, and `main` remains deployable.

## Design References

- `.dev/design/tool-spec.md` — the program's source of truth; the
  "High-value follow-up tools" list, the common contract, the
  market-data provenance requirement, and the explicit exclusions this
  epic honors.
- `docs/design/screener-followup-tools/spec.md` — this epic's behavioral
  spec: the scenarios each ticket implements.
- `docs/plan/EPIC-1006/_epic.md` — mutation envelope, revisions,
  idempotency, undo tokens, change history.
- `docs/plan/EPIC-1007/_epic.md` — panel registry; owns the `watchlist`
  and `alerts` panel kinds this epic binds to.
- `docs/plan/EPIC-1008/_epic.md` — catalog registry (permitted fields,
  functions, units, ranges) and the domain ports for reference and
  fundamental market data.
- `docs/plan/EPIC-1009/_epic.md` — screener, universe, and the typed
  filter-tree condition model `derive_filters_from_setup` emits into.
- `docs/plan/EPIC-1010/_epic.md` — pinned `run_id` semantics and the
  no-silent-rerun guarantee that `export_results` and
  `save_results_to_watchlist` depend on.
- `docs/plan/EPIC-1011/_epic.md` — captured-setup contract consumed by
  `derive_filters_from_setup`.
- `docs/plan/EPIC-1012/_epic.md` — similarity feature model and weights
  that `refine_similarity_search` adjusts.
- `backend/domain/`, `backend/infra/pandas_engine.py` — the existing
  layered Python engine pattern the backtest engine follows (forward
  returns, hit rates, and base rates already live here).
- `src/lib/webmcp/tools.ts`, `src/lib/webmcp/types.ts` — existing tool
  registration and handle-based typing conventions, for reference only;
  not modified by this epic.

## Open Questions

Recorded rather than resolved — `.dev/design/tool-spec.md` does not
answer these. Each carries a stated working assumption so no ticket
blocks on an answer.

1. **Backtest execution time.** The spec does not say whether
   `backtest_screener` is synchronous. *Assumption:* it is asynchronous —
   it returns a stable `backtest_id` immediately and
   `get_backtest_results` reads it, mirroring the pinned-run split
   between `run_screener` and `get_screener_results`.
2. **Alert delivery.** The spec covers alert lifecycle but not delivery
   channel (in-app, email, push). *Assumption:* in-app only; an armed
   alert surfaces in the `alerts` panel. Delivery channels are out of
   scope.
3. **Export destination.** The spec says "export the pinned run, filters,
   timestamp, and provenance" but not where it goes. *Assumption:*
   `export_results` returns a structured export payload plus a
   user-initiated download offered by the app; the tool itself does not
   write to disk or call an external service.
4. **Watchlist persistence scope.** The spec does not say whether
   watchlists are per-browser or account-scoped. *Assumption:*
   per-browser, consistent with the current app's local-only persistence
   model, behind a port so a server-backed store can replace it later.
5. **Backtest data depth.** Meaningful backtests need long history, which
   depends on the parallel market-data workstream. *Assumption:* the
   engine is built and tested against fixtures through EPIC-1008's ports;
   real-history verification happens when that workstream lands.

## Out of Scope

- `get_change_history` and `restore_workspace_revision` — listed in the
  spec's follow-up section but owned by EPIC-1006 (revisions and undo).
- Retiring the legacy 11-tool surface, `src/lib/workspace/store.ts`, or
  the current UI — EPIC-1015 does that, last, gated on user approval.
- Any trading, ordering, or position-management capability. The spec
  excludes any tool that combines screening with order placement; this
  epic adds none.
- Raw SQL execution, JavaScript evaluation, and DOM automation —
  explicitly excluded by the spec.
- Implementing the live reference/fundamental market-data pipeline. This
  epic consumes EPIC-1008's ports and does not build a mock pipeline of
  its own.
- Alert delivery channels beyond the in-app `alerts` panel.
