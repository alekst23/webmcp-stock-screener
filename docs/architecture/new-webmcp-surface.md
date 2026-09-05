# New WebMCP Surface

This doc covers the program-wide design of the ~33-tool WebMCP surface
rebuild (`docs/reference/tool-spec.md`), spanning EPIC-1006 through
EPIC-1015. It's for anyone implementing one of these epics, or wiring the
finished surface together, who needs the shape of the whole before reading
any one epic's code.

## Build alongside, cut over at the end

The new surface is built entirely in new files. The existing 11-tool
pattern-research surface (`src/lib/webmcp/tools.ts`, `src/lib/workspace/*`,
`src/routes/+page.svelte`) is left untouched by every epic in the program
except the last one, EPIC-1015, which retires it in a single user-gated
cutover. This keeps `main` deployable throughout construction — at any point
during the program, the shipped app is still the old 11-tool surface, and
the new one exists alongside it, unregistered, until cutover.

## Per-epic tool-group builders

Each epic that adds tools exposes one function, `build<Area>Tools(deps)`,
that takes its dependencies as explicit parameters (no module-level
singletons) and returns a `ToolSpec[]`. EPIC-1008 established the pattern
with `buildDiscoveryTools(deps)` in `src/lib/webmcp/discovery/group.ts`;
EPIC-1006's own workspace tool surface (`buildWorkbenchTools`) follows the
same shape. Building this way means composing the full surface is meant to
end up as a flat list of builder calls, not a merge negotiation between
epics — each epic's tools are fully self-contained and testable without the
others.

## Surface-shared contract modules

`docs/reference/tool-spec.md` specifies one contract every tool in the new
surface must obey: stable resource IDs (never a bare ticker or a
positional name like "panel 3"), and — for any result touching market or
reference data — a provenance envelope stating `as_of`, source, live/delayed
status, timezone, and (where applicable) currency, price-adjustment policy,
and fundamentals reporting period.

Two modules under `src/lib/surface/` implement this contract once, for the
whole surface, rather than per-epic:

| Module                          | Provides                                                                                                                                                                                  | Notes                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/surface/ids.ts`        | `makeInstrumentId`/`isInstrumentId` (`inst:<MIC>:<SYMBOL>`), `makeCatalogItemId`/`isCatalogItemId` (`<prefix>.<segment>` for field/op/study/indicator/pattern/interval/universe/template) | No workspace/panel/screener/run ID makers yet — that's expected to land as EPIC-1006 extends this module rather than starting a second one |
| `src/lib/surface/provenance.ts` | `DiscoveryEnvelope<T>`, `envelope<T>()`, plus re-exports of EPIC-1006's `MarketDataProvenance`/`makeProvenance()`                                                                         | Covers every field tool-spec.md's common contract requires for market-data results                                                         |

Both modules were built by EPIC-1008 (Discovery & Catalog), whose own tools
needed them first, but they're deliberately scoped to the whole surface, not
to discovery — sibling epics are expected to extend `ids.ts` with their own
resource-ID makers and reuse `MarketDataProvenance`/`envelope<T>()` rather than each
defining their own version. Whether that reuse actually happens as each
epic lands is worth checking at each epic's review.

The provenance record itself lives one layer in, at
`src/lib/workbench/domain/provenance.ts`: EPIC-1006 owns the common tool
contract, and for a while the two epics shipped two incompatible provenance
types in parallel. `src/lib/surface/provenance.ts` now re-exports the
canonical one and adds only what is genuinely discovery-specific — the
`warnings` array on `DiscoveryEnvelope<T>`.

## The composition root — resolved for `/workbench`'s panel/workbench-core/screener slice (EPIC-0020)

Per-epic builders only produce tool lists; something still has to import
every relevant epic's `build<Area>Tools`, wire real shared dependencies
(not each builder's own independent instances), and register the combined
tool list. EPIC-0020 owns this for `/workbench`'s currently-live subset:
`src/lib/workbench/composition/workbenchCompositionRoot.ts` builds exactly
one `WorkspaceRepository`, ID sequencer, idempotency cache, revision
service, change history, and `PinnedRunStore`, and threads that same bag
into `registerPanelTools()`, `registerWorkbenchTools()`, and
`registerScreenerTools()` — so a mutation or read through one tool group
(e.g. `create_panel`) is visible through another (`get_canvas_state`), and
a completed `run_screener` call auto-binds the workspace's `results_table`
panel to it. `WORKBENCH_TOOLS_ENABLED` and `SCREENER_TOOLS_ENABLED` are
both `true` for `/workbench` as of this epic; `src/routes/workbench/+page.svelte`
calls `registerWorkbenchComposition()` (not a bare `registerPanelTools()`)
to get this wiring.

This resolves the gap for the three tool groups `/workbench` actually
registers today. It does **not** extend to the rest of the ~33-tool
program: `CHART_TOOLS_ENABLED`, `SIMILARITY_TOOLS_ENABLED`, and
EPIC-1014's followup/backtest/alert/watchlist flags stay `false` and
unregistered on `/workbench` (EPIC-0020's own explicit scope boundary), and
EPIC-1015's cutover — presupposing the _entire_ new surface assembled
where the old 11-tool surface registers today — remains open and paused,
unaffected by this work.

(This section's "`/workbench`" predates EPIC-1015's later route migration,
which retired that path and moved this same composition onto `/` —
`src/routes/+page.svelte` is this composition's only call site as of
T-1015-3/T-1015-9. Read "`/workbench`" below as "whichever path serves this
composition", not literally that URL.)

### Amendment (EPIC-0020, 2026-09-04): create-if-absent, recycling, and human-triggered runs

The composition root resolved above wires the tool groups together; it does
not by itself explain what a completed run does to the panel grid. A later
ticket wave under this same epic (T-0020-10/T-0020-11) amended
`run_screener`'s auto-bind behavior and added a human-facing equivalent
(`runScreenerByHuman`, `src/lib/panels/shell/panelController.ts`):

- if the workspace has no `results_table` panel when a run completes, one is
  created (2x1, auto-placed) and bound to that run, rather than the bind
  being a no-op;
- rerunning the current screener — by an agent's `run_screener` call or a
  human clicking the filter panel's Run control — recycles that same panel
  in place instead of creating another one, regardless of which actor
  created it or which actor reruns it;
- a human can trigger a run directly from the filter panel without an agent
  in the loop, going through the identical evaluate/pin/bind pipeline
  `run_screener` uses, just attributed to the human actor in the action log.

A follow-up review pass (T-0020-15) found `bindRunToResultsPanel` living in
`runScreener.ts` was a tool-layer module reaching backward to hold
application-layer logic, since `panelController.ts` (panels/shell) needed to
call it too. It now lives in `src/lib/panels/application/bindRunToResultsPanel.ts`,
alongside `createPanel`/`bindPanelSource`, imported symmetrically by both
`runScreener.ts` and `panelController.ts` — the same reviews pass also
rekeyed `runScreenerByHuman`'s single-flight guard from an (unintentionally
inert) object-identity `WeakMap` to a `Map<workspaceId, ...>`, and added
user-visible messaging for a human-triggered run that is refused or errors,
neither of which the button previously surfaced.

The same ticket wave (T-0020-12/T-0020-13) also sharpened `run_screener`'s
and `define_screener`'s revision-parameter descriptions and rejection text
(distinguishing the workspace's own revision from the screener definition's
own revision, which an agent had conflated live) and added the price
source's data as-of date to chart "no data" refusals.

The full behavioral spec for this amendment — including the "Create-if-absent
results panel", "Human-triggered run", "Recycled results panel",
"Disambiguated revision parameters", and "Diagnosable chart data gaps"
scenarios — lives in `docs/design/workbench-composition-root/spec.md`; this
section only records that the composition root's binding behavior changed
and where to find the details, rather than duplicating them.

## References

- `docs/reference/tool-spec.md` — the tool inventory and common contract
- `docs/plan/project.md` — program status and wave order
- `src/lib/webmcp/discovery/group.ts` — the reference implementation of the
  per-epic builder pattern
- `src/lib/surface/ids.ts`, `src/lib/surface/provenance.ts` — the
  surface-shared contract modules
- `src/lib/workbench/composition/workbenchCompositionRoot.ts` — EPIC-0020's
  shared composition root for `/workbench`'s panel/workbench-core/screener
  tool groups
- `docs/design/workbench-composition-root/spec.md` — the full behavioral
  spec for the composition root and its create-if-absent/recycling/
  human-triggered-run amendment
