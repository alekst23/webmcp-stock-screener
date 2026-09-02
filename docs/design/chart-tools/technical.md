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
`capture_chart_setup` writes it; EPIC-1012's `find_similar_setups`,
`explain_similarity` and `compare_setups` read it, and they are its only
consumers. It must be self-contained: a consumer never reads the live
chart, and reconfiguring or removing the source panel does not invalidate
a captured record.

**Changing this shape is a coordinated cross-epic change.** Both sides
land together, and a record already persisted in a workspace must keep
normalizing — a captured setup outlives the chart it came from, so an
unannounced field rename silently breaks records that already exist.

Defined in `src/lib/workbench/chart/domain/capturedSetup.ts`, which is
the whole contract: the record type, `buildCapturedSetup` (the only
constructor), `toWireCapturedSetup` (the only snake_case serializer),
`normalizeCapturedSetup` (normalize-on-read), `CaptureSetupError`, and
the setup store described below. Field names in the tables are the wire
names; the TypeScript identifiers are the `camelCase` equivalents.

| Field | Type | Description |
|-------|------|-------------|
| `setup_id` | stable ID, `setup_`-prefixed | addresses the record; the only thing EPIC-1012 needs to run |
| `captured_at` | ISO timestamp | when the capture was taken |
| `workspace_revision` | number | the revision whose state was frozen. The capture itself commits at `revision + 1`, and its own existence is the only difference between the two |
| `source_panel_id` | stable ID | chart panel it came from; informational, not a live reference — the panel may be gone |
| `name` | string, optional | caller-supplied; absent rather than null when not given |
| `notes` | string, optional | caller-supplied; absent rather than null when not given |
| `instrument` | `InstrumentRef` | instrument ID, symbol, exchange, asset type — never a bare ticker as identifier |
| `window` | `SetupWindow` | the historical window captured |
| `candle_type` | enum | `candlestick`, `ohlc_bar`, `line`, `area`, `heikin_ashi`, `hollow_candle` |
| `scale` | enum | `linear`, `logarithmic` |
| `price_adjustment` | enum | the **chart's** policy: `adjusted`, `split_adjusted`, `unadjusted`. Distinct from `provenance.price_adjustment`, which is the basis the source actually applied; both are recorded because the chart's vocabulary is wider than provenance's |
| `normalization` | `Normalization` | how the series is made comparable; explicit, never defaulted at search time. Defaults to `{none, window_start}` at capture, and that default is recorded rather than implied |
| `studies` | ordered `CapturedStudy[]` | every study instance, with resolved parameters |
| `comparisons` | `ComparisonRef[]` | comparison instruments and their normalization mode |
| `annotations` | `CapturedAnnotation[]`, optional in TypeScript | drawings present at capture time. Always emitted on the wire, as `[]` when there are none |
| `provenance` | `MarketDataProvenance` | the data the capture was taken from |

### `SetupWindow`

| Field | Type | Description |
|-------|------|-------------|
| `start` | ISO timestamp | inclusive window start — the first bar the capture covers, not the chart's configured range bound |
| `end` | ISO timestamp | inclusive window end — the last bar the capture covers |
| `timeframe` | enum | bar interval, e.g. 1m / 5m / 1h / 1d / 1wk / 1mo |
| `session` | enum | `regular`, `extended`, `continuous` |
| `bar_count` | number | bars in the window at capture time. Zero is rejected, never stored |
| `anchor_time` | ISO timestamp, optional | the bar the setup is "about", when one is distinguished. Must fall inside `[start, end]` |

### `Normalization`

| Field | Type | Description |
|-------|------|-------------|
| `mode` | enum | `none`, `percent_change`, `indexed_100`, `z_score` |
| `anchor` | enum | `window_start`, `anchor_bar` — where the normalization is based |

### `InstrumentRef` and `ComparisonRef`

Re-exported from `capturedSetup.ts` so a consumer imports the whole
contract from one module.

| Field | Type | Description |
|-------|------|-------------|
| `instrument_id` | string | canonical and opaque; never a bare ticker |
| `symbol` | string | display ticker — identity, not identifier |
| `exchange` | string | ISO 10383 MIC of the listing venue |
| `asset_type` | enum | `equity`, `etf`, `adr`, `fund`, `index`, `future`, `fx`, `crypto` |

A `ComparisonRef` is `{instrument: InstrumentRef, normalization: Normalization}`.

### `CapturedStudy`

| Field | Type | Description |
|-------|------|-------------|
| `study_id` | stable ID, `study_`-prefixed | stable across update, reorder, and toggle |
| `catalog_item_id` | string | resolves through EPIC-1008's catalog |
| `params` | map of name -> value | fully resolved, defaults included — never partial |
| `pane` | enum | `price_overlay` or `sub_pane` |
| `order` | number | display order within its pane |
| `enabled` | boolean | toggled state at capture time |

### `CapturedAnnotation`

| Field | Type | Description |
|-------|------|-------------|
| `annotation_id` | stable ID, `annotation_`-prefixed | |
| `kind` | enum | `trendline`, `price_level`, `date_range`, `label`, `setup_window` |
| `anchors` | kind-specific | trendline: two `{time, price}`; price level: one `price`; date range and setup window: `{start, end}`; label: one `{time, price}` plus `text` |
| `price_adjustment` | enum | the policy in force when it was drawn; a mismatch with the setup's policy marks it stale. Stale drawings are captured as drawn, and the capture warns rather than dropping or re-basing them |
| `label` | string, optional | |

### How EPIC-1012 reads a captured setup

Setups live in `WorkspaceDocument.extensions.chart_setups`, keyed by
setup ID, and are read through the store exported alongside the type —
never by reaching into `extensions` directly:

| Export | Signature | Purpose |
|--------|-----------|---------|
| `CAPTURED_SETUP_EXTENSION_KEY` | `'chart_setups'` | the extension key, so nothing hard-codes the string |
| `readCapturedSetup` | `(doc, setupId) => CapturedChartSetup \| null` | retrieve one by ID; the entry point for a similarity search given a setup ID |
| `readCapturedSetups` | `(doc) => CapturedChartSetup[]` | every complete record in the workspace |
| `writeCapturedSetup` | `(doc, setup) => WorkspaceDocument` | returns a new document; captures accumulate and never overwrite |
| `capturedSetupIdSeed` | `(doc) => Record<string, number>` | high-water marks for `createIdSequencer`, so a reloaded workspace never re-mints an existing setup ID |

Both readers normalize on read: a persisted record that cannot be read
back as a complete setup is dropped rather than half-restored, because a
partial setup is exactly what this contract promises never to hand
downstream.

### Refusing to capture

`buildCapturedSetup` throws `CaptureSetupError` rather than returning a
record missing an instrument or covering no bars, so a partial setup is
never stored and never handed downstream. `capture_chart_setup` detects
both conditions before it commits anything, and surfaces the error as
`{error: 'capture_setup_incomplete', message, issues[]}` — `issues`
naming every missing or invalid field at once.

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
