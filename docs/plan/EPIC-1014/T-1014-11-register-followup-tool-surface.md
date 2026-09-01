# T-1014-11: Register and integrate the follow-up tool surface

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Open
**Depends on**: T-1014-2, T-1014-3, T-1014-4, T-1014-6, T-1014-7,
T-1014-9, T-1014-10
**Blocks**: — (unblocks EPIC-1015 cutover)
**Issue**: —

## Description

The wiring ticket. Register all 13 follow-up tools on the new WebMCP
surface with descriptions and input schemas an agent can actually use,
make availability reflect workspace state, and prove the end-to-end flows
the epic exists for.

Each preceding ticket delivers a capability. This one makes the set
usable as a whole and verifies the epic's cross-cutting guarantees hold
across every tool at once, rather than one ticket at a time.

## User Story

As an AI agent connected to the workbench,
I want the follow-up tools discoverable, well-described, and callable
alongside the core surface,
so that I can carry a piece of research from a screen through refinement,
validation, and saving without falling off the end of the tool set.

## Acceptance Criteria

1. All 13 follow-up tools — `refine_similarity_search`,
   `derive_filters_from_setup`, `create_computed_field`,
   `create_custom_study`, `backtest_screener`, `get_backtest_results`,
   `upsert_watchlist`, `save_results_to_watchlist`, `create_alert_draft`,
   `preview_alert`, `enable_alert`, `disable_alert`, and
   `export_results` — are registered on the new surface, discoverable
   with a description and an input schema, and callable end to end.
2. Tool availability reflects workspace state: a tool whose
   prerequisites are absent (no screener, no pinned run, no captured
   setup, no similarity search) is reported unavailable rather than
   failing opaquely when called.
3. Every tool's description tells an agent when to reach for it and what
   it returns, and every input schema names the stable-ID inputs it
   expects.
4. A cross-tool test verifies the mutation contract uniformly: for every
   mutating tool in this epic, a stale `expected_revision` is rejected
   without mutating, a repeated `idempotency_key` returns the original
   result without re-applying, and the response carries the full
   envelope.
5. A cross-tool test verifies that every mutation this epic creates is
   reversible through `undo_change` with its returned undo token.
6. An adversarial test enumerates the registered surface and confirms no
   sequence of calls transitions an alert to armed without a human
   confirmation.
7. An end-to-end test covers the epic's principal flow: derive a draft
   filter tree from a captured setup, accept it onto a screener, run and
   backtest it, save the results to a watchlist, draft and preview an
   alert, and export the pinned run — with provenance present at every
   step that carries market data.
8. A second end-to-end test covers the authoring and refinement flow:
   create a computed field and a custom study, use them in a filter and
   on a chart, then refine a similarity search from accepted and rejected
   matches.
9. Resources created by this epic — computed fields, custom studies,
   draft filter trees, backtests, watchlists, alerts, exports — are
   visible to the researcher through the workspace and its panels, not
   only through tool responses.
10. The legacy 11-tool surface, `src/lib/workspace/`, and the current UI
    are unmodified; the app builds, typechecks, and the full test suite
    passes.

## Design References

- `docs/design/screener-followup-tools/spec.md` — the full scenario set;
  the "Contract obligations shared by every mutating tool here" table is
  what AC4 and AC5 verify.
- `docs/reference/tool-spec.md` — the complete follow-up tool list and the
  common contract.
- `docs/plan/EPIC-1006/_epic.md` — the mutation envelope, revision
  checks, idempotency, and `undo_change` that the cross-tool tests
  exercise.
- `docs/plan/EPIC-1007/_epic.md` — the panels through which created
  resources become visible.
- `src/lib/webmcp/tools.ts`, `src/lib/webmcp/register.ts`,
  `src/lib/webmcp/bridge.ts` — the existing registration, availability
  (`available(ws)`), and page-owned bridge patterns, for reference; this
  ticket registers on the new surface and does not modify these.

## Technical Considerations

- Tool descriptions are the agent's entire documentation. Descriptions
  that say what a tool does but not when to use it produce agents that
  never call it.
- The follow-up surface is large. Availability gating is what keeps it
  from overwhelming an agent that has not yet built a screener.
- The cross-tool contract tests (AC4, AC5) should be driven off the
  registered tool list, so a tool added later without the envelope fails
  the test rather than slipping through.
- AC6 is a regression guard for the epic's central safety property; it
  belongs in the permanent suite, not a one-off check.

## Out of Scope

- Retiring the legacy surface (EPIC-1015).
- Any change to the core epics' tools.
- New panel kinds — this ticket binds to the ones EPIC-1007 provides.
- Live verification against real market data, which waits on the parallel
  market-data workstream.
