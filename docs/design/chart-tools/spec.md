# Chart Tools — Product Spec

## Intent

An agent working alongside a researcher in the stock research workbench
needs a real chart it can drive, not a picture it can only describe. This
feature gives it five capabilities on a chart panel: say what the chart
shows, put studies on it, read a bounded slice of the underlying numbers,
mark the chart up, and capture the whole configuration as a reusable
reference setup.

The point is shared evidence. When the agent says "the RSI diverged at
the September high", the human should be able to see the RSI, the high,
and the trendline the agent drew — on the same chart, with the same
adjustment policy and the same as-of time. The captured setup is the
durable form of that agreement: a complete, ID-addressable description of
a chart that similarity search can later run from without anyone
rebuilding it from memory.

Done looks like: an agent configures a chart by instrument ID, adds a
50/200 moving average and an RSI, reads 200 bars of OHLCV and study
output with full provenance, draws a trendline and shades the breakout
window, and captures the result as a reference setup.

## Preconditions

- A chart panel exists in the workspace (created through the panel tools,
  which are a separate concern).
- The instrument has been resolved to an instrument ID through
  instrument search — a bare ticker is never accepted.
- Bar data for the instrument is reachable through the chart series port;
  reference and fundamental data arrive through the catalog's ports.

## Features

1. **Configure the chart**: set instrument, timeframe, visible range,
   candle type, price scale, session, comparison instruments, and the
   price-adjustment policy.
2. **Manage studies**: add, update, reorder, toggle, and remove studies —
   moving averages, RSI, MACD, Bollinger Bands, VWAP, ATR — resolved
   through the catalog.
3. **Read a bounded slice of the chart**: retrieve OHLCV values and study
   outputs over an explicitly bounded window, with full provenance.
4. **Annotate the chart**: add a trendline, price level, date range,
   label, or highlighted setup window.
5. **Capture a reference setup**: freeze the instrument, window, studies,
   and normalization settings into an ID-addressable record.

## Behavioral Specifications

### Configure the chart

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a chart panel and a resolved instrument ID | the agent sets instrument, timeframe, and range | the chart shows that instrument over that range at that timeframe, and the result summarizes what changed |
| Partial update | a fully configured chart | the agent sets only the candle type | only the candle type changes; every other property is untouched |
| Bare ticker | a chart panel | the agent supplies a ticker string instead of an instrument ID | the call is rejected with a message directing the caller to resolve the ticker first |
| Adjustment policy | a chart on adjusted prices | the agent switches to unadjusted | subsequent prices, study values, and reads are computed unadjusted, and every payload says so |
| Comparison | a chart showing one instrument | the agent adds a comparison instrument | both series are drawn under the configured normalization mode; omitting the mode applies the documented default and reports it |
| Stale revision | a workspace at revision N | the agent submits `expected_revision` of N-1 | nothing changes and the result names both the expected and the actual revision |
| Replay | a call already applied under an idempotency key | the same key is submitted again | the original result is returned and the change is not applied twice |
| Undo | a configuration change just applied | the returned undo token is used | the chart returns to exactly its prior configuration |
| Invalid range | a chart panel | the agent sets an end date before the start date, or a range with no data for that instrument | the call is rejected naming the offending field; the chart is unchanged |

### Manage studies

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a configured chart | the agent adds RSI with a period | the study appears with a stable instance ID, on the pane the catalog declares |
| Defaults | a configured chart | the agent adds MACD without parameters | the catalog's defaults are applied and reported in the result |
| Two of a kind | a chart with a 50-period moving average | the agent adds a 200-period moving average | both exist with distinct instance IDs |
| Update | an existing study instance | the agent changes its period | values recompute and the instance keeps its ID |
| Reorder and toggle | several studies on a chart | the agent reorders them, then toggles one off and on | no instance ID changes and the toggled study keeps its parameters |
| Remove | several studies on a chart | the agent removes one by ID | the remaining studies keep their IDs and relative order |
| Batch atomicity | a batch of study operations, one invalid | the agent submits the batch | none of the operations is applied and the result names which one failed and why |
| Unknown item | a configured chart | the agent names a catalog item that does not exist | the call is rejected with a message directing the caller to catalog search |
| Bad parameter | a study being added | a parameter is outside the catalog's valid range | the call is rejected naming the parameter, the value, and the permitted range |
| Warm-up longer than range | a chart showing 30 bars | the agent adds a 200-period moving average | the study is added with a warning that it will have no plotted values in the current range |

### Read a bounded slice of the chart

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a chart with studies over a visible range | the agent requests the last 200 bars | OHLCV and each enabled study's outputs are returned, aligned bar-for-bar, with the per-call cap stated |
| Default window | a configured chart | the agent requests data without naming a window | the chart's currently visible range is used and the result says so |
| Over the cap | a window resolving to more bars than the per-call cap | the agent requests it | the call is refused, stating the cap, the bars available, and at least two remedies — narrow the window, or request a coarser aggregation |
| Aggregated fit | a wide window and a requested coarser aggregation | the agent requests it | bars are returned labelled as aggregated, with the aggregation applied, never passed off as raw bars |
| No unbounded loop | any successful read | the agent looks for a way to fetch "the next page" | none exists; each call must be independently bounded by the caller |
| Outside the chart | a chart configured to 6 months | the agent requests bars from 5 years ago | the call is refused with a message directing the caller to change the chart configuration first |
| Warm-up bars | a study with a warm-up period inside the window | the agent reads that window | bars inside the warm-up report an explicit absent value, not a substituted number |
| Provenance | any successful read | the agent inspects the response | `as_of`, source, live/delayed status, timezone, currency, effective adjustment policy, and calculation-engine version are all present |
| Empty window | a market holiday or an instrument with no data in range | the agent reads that window | an empty series with valid provenance is returned, not an error |
| Read is a read | any successful read | the call completes | the workspace revision is unchanged and no `expected_revision` was required |

### Annotate the chart

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a configured chart | the agent adds a trendline between two time-and-price points | it is drawn on the chart and a stable annotation ID is returned |
| Every kind | a configured chart | the agent adds a price level, a date range, a label, and a highlighted setup window | each is drawn at its anchors with its own ID |
| Wrong anchors | an annotation request | the anchors do not fit the kind (one point for a trendline, a price for a date range) | the call is rejected naming what was expected |
| Out of range | a chart configured to 6 months | the agent anchors an annotation outside that range | the call is rejected naming the chart's current range, rather than adding an invisible annotation |
| Inverted or non-finite | an annotation request | an end precedes its start, or a price is not a finite number | the call is rejected |
| Adjustment change | a price level drawn on unadjusted prices | the chart switches to adjusted prices | the annotation is flagged stale and visibly distinguished, not silently re-plotted at a price that no longer means the same thing |
| Range scroll | an annotation on a chart | the visible range moves away and back | the annotation is still attached to the same times and prices |

### Capture a reference setup

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a configured chart with studies | the agent captures the setup | a stable setup ID is returned and a record stores instrument, window, timeframe, session, candle type, scale, normalization, ordered studies, comparisons, adjustment policy, and provenance |
| Self-contained | a captured setup | the source panel is later reconfigured or removed | the captured record is unchanged and still fully interpretable |
| Repeat capture | a setup already captured from this chart | the agent captures again | a second, distinct setup ID is created; the first record is unchanged |
| Named | a capture request with a name and notes | the agent captures | the name and notes are stored and returned with the record |
| Nothing to capture | a chart with no instrument, or a window with no bars | the agent captures | the call is rejected saying what is missing and no partial record is stored |
| Round trip | a captured setup | the workspace is persisted and reloaded | the setup is retrievable by ID, unchanged |
| Consumed downstream | a captured setup ID | similarity search is asked to find matches | it can run from the ID alone, without reading the live chart |

## Non-Goals

- Creating, moving, linking, or removing panels — the panel container and
  panel-kind registry are a separate concern.
- The catalog itself: study definitions, parameter metadata, units,
  valid ranges, and availability.
- Similarity search, similarity explanation, and setup comparison — this
  feature produces the captured setup they consume, and nothing more.
- Custom user-defined studies and computed fields.
- Backtesting, alerts, watchlists, and export.
- Human mouse-driven chart interactions beyond hover readout — drawing
  tools, drag-to-zoom, and pan.
- Building a market-data pipeline; bars and reference data arrive through
  ports owned elsewhere.
- Anything touching order placement.

## Open Questions

1. **Wire-format casing** — the program's tool spec names envelope fields
   in `snake_case` while the existing surface uses `camelCase`.
   Assumption: `snake_case` on the wire for every field the spec names,
   `camelCase` for TypeScript identifiers. The workspace/revision epic is
   authoritative and this follows it.
2. **Ownership of the OHLCV bars port** — the catalog epic owns
   reference and fundamental data ports; it is unsettled whether the
   price *bar* port belongs there. Assumption: a narrow chart series port
   is declared here and aliased to the shared one if that lands.
3. **The per-call bar cap** — no value is given in the source spec.
   Assumption: 500 bars, exposed as a named constant so app context can
   report it, chosen so a year of daily bars fits in two calls.

---

*Implemented by: EPIC-1011*
