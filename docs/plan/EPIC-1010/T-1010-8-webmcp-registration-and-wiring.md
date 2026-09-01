# T-1010-8: WebMCP registration and end-to-end wiring for the four Results tools

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Open
**Depends on**: T-1010-7
**Blocks**: —

## Description

The integration ticket: expose `configure_results_table`,
`get_screener_results`, `select_result`, and `explain_result` as WebMCP
tools on the new surface, wired to the Wave 2 use cases and the
`results_table` panel, with the tool descriptions and schemas an agent
needs to use them correctly on the first try. After this ticket the epic's
capability is reachable end to end from an agent.

## User Story

As an agent connected to the app,
I want the four Results tools available with schemas and descriptions that
tell me what they need and what they return,
so that I can shape a results table, page a run, select a row, and audit a
verdict without trial and error.

## Acceptance Criteria

1. All four tools are registered on the new WebMCP surface and appear in
   the tool listing with names matching the design doc exactly.
2. Each tool's input schema declares its parameters with types,
   requiredness, and descriptions; the two mutations declare
   `expected_revision` and `idempotency_key`.
3. Each tool's description states what it returns and its key constraint —
   in particular that `get_screener_results` reads an existing run and
   never reruns it, and that `explain_result` covers rejected candidates as
   well as results.
4. Tools are advertised as available only when their preconditions hold
   (for example, a results tool requires a results panel bound to a run),
   following the existing availability convention.
5. Errors are returned in the surface's error shape with actionable
   messages: an unknown field names the field and the permitted set, a
   revision conflict names the current revision, an expired run names the
   run and says to re-run the screener.
6. An end-to-end test drives the sequence configure → read page → select →
   explain against a run fixture and asserts the outcome of each step,
   including that no screener execution occurred at any point.
7. A round-trip test confirms an agent-driven configuration change is
   visible in the rendered panel, and a panel-driven selection is visible
   to a subsequent tool read.
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
