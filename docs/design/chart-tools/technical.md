# Chart Tools — Technical Design

Contracts introduced by EPIC-1011. Field names below are the **wire**
names used in tool payloads (`snake_case`, following
`docs/reference/tool-spec.md`); TypeScript identifiers are `camelCase` per
project convention. EPIC-1006 is authoritative on the casing question —
see the spec's Open Questions.

## Consumed from other epics — not defined here

| Contract | Owner | Used for |
|----------|-------|----------|
| Workspace / revision model, stable ID scheme | EPIC-1006 | every chart mutation's `expected_revision` and `new_revision` |
| Mutation envelope (`change_id`, `new_revision`, `affected_ids`, `diff_summary`, `warnings`, `undo_token`), `idempotency_key`, undo tokens | EPIC-1006 | the return shape of all four chart mutations |
| Provenance type | EPIC-1006 | populated by the chart series port; embedded in reads and captures |
| Panel container and panel-kind registry | EPIC-1007 | the `chart` panel kind registers into it |
| Catalog registry (`search_catalog`, `describe_catalog_item`) | EPIC-1008 | resolving studies, their parameters, ranges, defaults, outputs, and pane placement |

## Cross-epic contract: `CapturedChartSetup`

**This is the interface between EPIC-1011 and EPIC-1012.**
`capture_chart_setup` writes it; `find_similar_setups`,
`explain_similarity`, and `compare_setups` read it. It must be
self-contained: a consumer never reads the live chart, and reconfiguring
or removing the source panel does not invalidate a captured record.
Changing this shape after T-1011-8 lands is a coordinated change across
both epics.

| Field | Type | Description |
|-------|------|-------------|
| `setup_id` | stable ID, `setup_`-prefixed | addresses the record; the only thing EPIC-1012 needs to run |
| `captured_at` | ISO timestamp | when the capture was taken |
| `workspace_revision` | number | revision the capture was taken at |
| `source_panel_id` | stable ID | chart panel it came from; informational, not a live reference |
| `name` | string, optional | caller-supplied |
| `notes` | string, optional | caller-supplied |
| `instrument` | `InstrumentRef` | instrument ID, symbol, exchange, asset type — never a bare ticker as identifier |
| `window` | `SetupWindow` | the historical window captured |
| `candle_type` | enum | candlestick, ohlc bar, line, area, heikin-ashi, hollow candle |
| `scale` | enum | linear, logarithmic |
| `price_adjustment` | enum | `adjusted`, `split_adjusted`, `unadjusted` |
| `normalization` | `Normalization` | how the series is made comparable; explicit, never defaulted at search time |
| `studies` | ordered `CapturedStudy[]` | every study instance, with resolved parameters |
| `comparisons` | `ComparisonRef[]` | comparison instruments and their normalization mode |
| `annotations` | `CapturedAnnotation[]`, optional | drawings present at capture time |
| `provenance` | `MarketDataProvenance` | the data the capture was taken from |

### `SetupWindow`

| Field | Type | Description |
|-------|------|-------------|
| `start` | ISO timestamp | inclusive window start |
| `end` | ISO timestamp | inclusive window end |
| `timeframe` | enum | bar interval, e.g. 1m / 5m / 1h / 1d / 1wk / 1mo |
| `session` | enum | `regular`, `extended`, `continuous` |
| `bar_count` | number | bars in the window at capture time |
| `anchor_time` | ISO timestamp, optional | the bar the setup is "about", when one is distinguished |

### `Normalization`

| Field | Type | Description |
|-------|------|-------------|
| `mode` | enum | `none`, `percent_change`, `indexed_100`, `z_score` |
| `anchor` | enum | `window_start`, `anchor_bar` — where the normalization is based |

### `CapturedStudy`

| Field | Type | Description |
|-------|------|-------------|
| `study_id` | stable ID, `study_`-prefixed | stable across update, reorder, and toggle |
| `catalog_item_id` | string | resolves through EPIC-1008's catalog |
| `params` | map of name -> value | fully resolved, defaults included — never partial |
| `pane` | enum | `price_overlay` or `sub_pane`, as the catalog declares |
| `order` | number | display order within its pane |
| `enabled` | boolean | toggled state at capture time |

### `CapturedAnnotation`

| Field | Type | Description |
|-------|------|-------------|
| `annotation_id` | stable ID, `anno_`-prefixed | |
| `kind` | enum | `trendline`, `price_level`, `date_range`, `label`, `setup_window` |
| `anchors` | kind-specific | trendline: two `{time, price}`; price level: one `price`; date range and setup window: `{start, end}`; label: one `{time, price}` plus `text` |
| `price_adjustment` | enum | the policy in force when it was drawn; a mismatch with the chart's current policy marks it stale |
| `label` | string, optional | |

## `MarketDataProvenance`

Populated by the chart series port (T-1011-3), embedded in every chart
data read and every captured setup. The type itself is EPIC-1006's; the
fields the spec requires are:

| Field | Type | Description |
|-------|------|-------------|
| `as_of` | ISO timestamp | data currency |
| `source_id` | string | stable provider identifier |
| `source_label` | string | human-readable provider name |
| `liveness` | enum | `live`, `delayed`, `end_of_day`, `historical` or `static` |
| `delay_seconds` | number, present when and only when `delayed` | |
| `timezone` | IANA zone | exchange timezone the timestamps are in |
| `currency` | ISO 4217, optional | the prices' currency |
| `price_adjustment` | enum, optional | the policy **actually applied**, which may differ from the one requested |
| `reporting_period` | object, optional | present only when fundamentals contributed |
| `engine_version` | string | study calculation engine version (T-1011-2) |

## Chart state contracts

### `ChartConfig` (T-1011-1)

| Field | Type | Description |
|-------|------|-------------|
| `panel_id` | stable ID | the chart panel this configures |
| `instrument` | `InstrumentRef`, nullable | null until configured |
| `timeframe` | enum | bar interval |
| `range` | explicit `{start, end}` or relative token | the visible range |
| `candle_type` | enum | |
| `scale` | enum | linear, logarithmic |
| `session` | enum | regular, extended, continuous |
| `comparisons` | `ComparisonRef[]` | |
| `price_adjustment` | enum | `adjusted` (default), `split_adjusted`, `unadjusted` — the default is recorded, not implied |

Partial updates apply only named fields (spec: "Partial update"), and
changing `timeframe`, `range`, `session`, or `price_adjustment`
invalidates cached bars and study output for that chart.

### `ChartSeriesPort` (T-1011-3)

Declared in the domain layer; implemented in the infrastructure layer.
The port cannot express an unbounded request — this is the first half of
the epic's boundedness guarantee.

| Input | Type |
|-------|------|
| `instrument_id` | stable ID |
| `timeframe` | enum |
| `window` | explicit `{start, end}` — required, no "all" |
| `price_adjustment` | enum |
| `session` | enum |

Returns bars plus `MarketDataProvenance`. An empty window yields an
empty series with valid provenance, not an error. A source failure
surfaces as a typed chart-layer error carrying its cause.

### Bounded read (T-1011-6)

| Aspect | Rule |
|--------|------|
| Window forms | explicit `{start, end}`, `last_n_bars`, or `{anchor_time, bars_before, bars_after}`; omitting all three uses the chart's visible range and says so |
| Per-call cap | a named constant, working assumption 500 bars, stated in the result and in the tool description |
| Over cap | refused, never truncated; the refusal states the cap, the bars available, and two remedies (narrow, or aggregate coarser) |
| Pagination | **none** — no continuation cursor, deliberately. A "next page" affordance re-creates the unbounded pull the spec forbids; the caller narrows its own window instead |
| Outside the chart | refused, directing the caller to reconfigure the chart first, so reads cannot reach past what the human can see |
| Alignment | study outputs are index-aligned to the returned bars; warm-up bars carry an explicit absent value |
| Mutation | none: no revision change, no `expected_revision` required |

## Process topology

Every component this epic introduces runs in the **browser process**.
There is no cross-process channel and no new server component.

| Component | Layer | Process |
|-----------|-------|---------|
| Chart domain model, study instances, annotations, `CapturedChartSetup` (T-1011-1) | domain | browser |
| Study calculation engine (T-1011-2) | domain | browser |
| `ChartSeriesPort` contract (T-1011-3) | domain | browser |
| Chart series adapter (T-1011-3) | infra | browser |
| Five chart tool handlers (T-1011-4 … T-1011-8) | application | browser |
| `chart` panel component (T-1011-9) | component | browser |

The adapter's only out-of-process dependency is the existing backend
price API over HTTP. Tools mutate the workspace store EPIC-1006 owns; the
chart panel reads that same store reactively, so no push channel between
tools and the panel is needed. All five tools are constructed once at the
application composition root (T-1011-9, AC7).

## Isolation from the existing surface

Everything above lives in new files. `src/lib/webmcp/tools.ts`,
`src/lib/workspace/store.ts`, `PriceChart.svelte`, `FocusChart.svelte`,
and `ChartToolbar.svelte` are read for their conventions — the SVG
geometry technique in `src/lib/workspace/visualization.ts`, the
`ok`/`fail`/`run` result shaping in `tools.ts`, the normalize-on-read
persistence pattern in `store.ts` — and duplicated, never modified. The
existing 11-tool surface keeps working until EPIC-1015 retires it.

---

*Product design: [spec.md](spec.md)*
