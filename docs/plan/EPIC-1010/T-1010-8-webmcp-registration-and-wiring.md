# T-1010-8: WebMCP registration and end-to-end wiring for the Results tools and table-renderer contract

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Open
**Depends on**: T-1010-7
**Blocks**: —

## Description

The integration ticket: expose `get_screener_results` and
`explain_result` as WebMCP tools on the new surface, register the
table-renderer contract (T-1010-6) into EPIC-1007's source/renderer
registry so its `configure_panel_view` and `set_panel_selection` tools
resolve to this epic's behavior for `table`-rendered panels, and wire
both to the Wave 2 use cases and the `results_table` panel, with the tool
descriptions and schemas an agent needs to use them correctly on the
first try. After this ticket the epic's capability is reachable end to
end from an agent — two tools this epic registers directly, plus
configuration and selection reached through EPIC-1007's generic panel
tools.

## User Story

As an agent connected to the app,
I want to read and audit screener results directly, and to shape a
results table and select a row through the same generic panel tools I use
for every panel,
so that I can page a run, select a row, and audit a verdict without trial
and error, and without learning a results-specific tool for something
every other panel already does one way.

## Acceptance Criteria

1. Both `get_screener_results` and `explain_result` are registered on the
   new WebMCP surface and appear in the tool listing with names matching
   the design doc exactly. The table-renderer contract is registered into
   EPIC-1007's source/renderer registry under the `table` renderer name,
   and is reachable — not directly listed as a separate tool — through
   EPIC-1007's `configure_panel_view` and `set_panel_selection`.
2. Each of the two directly-registered tools' input schema declares its
   parameters with types, requiredness, and descriptions.
3. Each tool's description states what it returns and its key constraint —
   in particular that `get_screener_results` reads an existing run and
   never reruns it, and that `explain_result` covers rejected candidates as
   well as results.
4. Tools are advertised as available only when their preconditions hold
   (for example, a results tool requires a results panel bound to a run),
   following the existing availability convention.
5. Errors are returned in the surface's error shape with actionable
   messages: an unknown field names the field and the permitted set, a
   revision conflict names the current revision (surfaced through
   EPIC-1007's `configure_panel_view`/`set_panel_selection` when the
   table-renderer contract rejects a call), an expired run names the run
   and says to re-run the screener.
6. An end-to-end test drives the sequence configure (via
   `configure_panel_view`) → read page (`get_screener_results`) → select
   (via `set_panel_selection`) → explain (`explain_result`) against a run
   fixture and asserts the outcome of each step, including that no
   screener execution occurred at any point.
7. A round-trip test confirms an agent-driven configuration change made
   through `configure_panel_view` is visible in the rendered panel, and a
   panel-driven selection is visible to a subsequent `get_screener_results`
   or `explain_result` call.
8. The existing 11 pattern-research tools remain registered and
   functional, and the app builds and runs with both surfaces present.
9. The project CI gate passes: formatting, lint, type check, and the full
   test suite.

## Design References

- `docs/design/results-and-explain/spec.md` — the behavioral spec the
  end-to-end test traces.
- `docs/reference/tool-spec.md` — exact tool names, purposes, and the common
  contract.
- `src/lib/webmcp/register.ts` and `src/lib/webmcp/tools.ts` — the
  existing registration and `ToolSpec` conventions (`inputSchema`,
  `available`, `execute`, `ok`/`fail`) the new tools follow. Not modified
  by this epic.
- `src/lib/webmcp/integration.test.ts` — the existing end-to-end tool test
  pattern to follow.

## Technical Considerations

- Tool descriptions are the agent's only documentation — the existing
  `defineStudy` description, which returns the function catalog on a parse
  error, is the quality bar to match.
- Both surfaces coexist until EPIC-1015. Register the new tools alongside
  the old ones; do not remove or rename anything existing.
- AC6's "no screener execution" assertion should reuse the failing-on-
  execution run store double from T-1010-4 and T-1010-5 so the guarantee is
  enforced at the integration level too, not just per use case.

## Out of Scope

- Retiring the 11-tool pattern-research surface (EPIC-1015).
- Tools outside the Results area of the design doc.
