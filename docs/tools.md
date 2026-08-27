# WebMCP Tool Surface

The app is a hypothesis workbench, not a screener: the atom is a
`(ticker, date)` **event**, not a ticker. Tools operate on handles the agent
receives from earlier calls and the human can see (and manipulate) in the UI.

## Nouns

| Handle | Meaning |
|---|---|
| Study | Named derived series (`volume / sma(volume, 20)`) |
| Setup | Temporal pattern: sequence of condition steps with `within`/`sustained` |
| InstanceSet | Concrete `(ticker, date)` events matching a setup |
| Panel | Rendered view (small-multiples grid, histogram, chart) |

## Tools

| Tool | Does | Available when |
|---|---|---|
| `defineStudy` | Expression → studyId; parse errors return the function catalog | always |
| `defineSetup` | Condition steps + temporal windows → setupId | always |
| `findInstances` | Setup + universe/date filters → instanceSetId | always |
| `getWorkspace` | Shared state incl. the human's current focus/selection | always |
| `sampleInstances` | Concrete events (random/recent/best/worst) | instance set exists |
| `measure` | Metric across a set + universe base-rate comparison | instance set exists |
| `splitInstances` | Child sets by outcome (winners/losers) or condition | instance set exists |
| `showGrid` | Small-multiples panel aligned at t=0, study overlays | instance set exists |
| `focusInstance` | Zoom the user's view to one event | panel exists |

## Design rules

- **Dynamic registration**: the surface evolves with the research —
  `register.ts` diffs desired-vs-registered after every tool execution, so
  `measure` appears only once `findInstances` has produced a set. This is the
  `toolchange` story for the submission.
- **Self-correcting errors**: `ExpressionError` returns the full function
  catalog in the tool result (`isError: true`) instead of throwing, so the
  agent fixes its formula in one turn.
- **One tool per intent**: no near-duplicate tools (`measure` subsumes
  outcome measurement, cross-set measurement, and base-rate comparison);
  conditions are inline expressions, not a separate registry.
- **Results are JSON text content** in MCP-style `{ content: [...] }` shape.

## Code layout

```
src/lib/webmcp/types.ts     — handles, engine interface, WebMCP ambient types
src/lib/webmcp/tools.ts     — the 9 tool specs (schemas + execute wiring)
src/lib/webmcp/register.ts  — feature-detect + dynamic register/unregister
src/lib/webmcp/tools.test.ts — availability gating + error-catalog tests
```

The tools delegate to a `ResearchEngine` interface (`types.ts`). Not yet
built: the engine implementation (expression parser, temporal matcher,
data snapshot) and the UI (grid renderer, panels, focus tracking).
