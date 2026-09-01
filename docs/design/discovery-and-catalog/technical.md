# Discovery & Catalog — Technical Design

Contracts introduced by EPIC-1008. Two of them are consumed outside this
epic and should be treated as published:

- **The catalog registry query surface** — EPIC-1009 (`edit_filter_tree`)
  validates conditions against it; EPIC-1011 (`edit_chart_studies`)
  resolves study IDs through it.
- **`InstrumentDirectory`** — the integration seam a future
  reference/fundamental-data source implements against. Nothing supplies
  that data today and nobody owns sourcing it; the port and its honest
  no-source default are the deliverable.

Everything here lives in **new files**. `src/lib/webmcp/tools.ts`,
`src/lib/webmcp/types.ts`, `src/lib/webmcp/register.ts`, and
`src/lib/workspace/*` are not modified by this epic.

## Module layout

| Module | Layer | Contents |
|--------|-------|----------|
| `src/lib/surface/provenance.ts` | domain | `DiscoveryEnvelope`, `Provenance`, engine version (T-1008-1) |
| `src/lib/surface/ids.ts` | domain | stable-ID construction and validation (T-1008-1) |
| `src/lib/catalog/types.ts` | domain | catalog item type model (T-1008-2) |
| `src/lib/catalog/items.ts` | domain | seeded inventory, data only (T-1008-2) |
| `src/lib/catalog/registry.ts` | domain | query surface over the inventory (T-1008-2) |
| `src/lib/discovery/ports.ts` | domain | `InstrumentDirectory` and its record types (T-1008-3) |
| `src/lib/discovery/unavailableDirectory.ts` | infra | default adapter when nothing is configured (T-1008-3) |
| `src/lib/webmcp/discovery/*.ts` | api | the three tool specs (T-1008-4/5/6) |
| `src/lib/webmcp/discovery/group.ts` | api | `buildDiscoveryTools` (T-1008-7) |

`src/lib/surface/` is deliberately named for the whole new tool surface,
not for discovery: sibling epics need the same envelope.

## Contracts

### `Provenance` (`src/lib/surface/provenance.ts`, T-1008-1)

| Field | Type | Description |
|-------|------|-------------|
| `asOf` | `string` | ISO-8601 with offset; when the payload is true as of |
| `sourceId` | `string` | stable source identifier, e.g. `src.catalog.builtin` |
| `sourceLabel` | `string` | human-readable source name |
| `delivery` | `'live' \| 'delayed' \| 'end_of_day' \| 'static'` | `static` for the built-in catalog |
| `delaySeconds` | `number \| undefined` | required when `delivery` is `delayed` |
| `timezone` | `string` | IANA zone the payload's dates/times are expressed in |
| `currency` | `string \| undefined` | ISO 4217; absent when the payload has no monetary content |
| `priceAdjustment` | `'adjusted' \| 'unadjusted' \| 'not_applicable' \| undefined` | absent when the payload has no price content |
| `reportingPeriod` | `ReportingPeriod \| undefined` | absent when the payload has no fundamentals |
| `engineVersion` | `string` | calculation-engine version, from one declared constant |

`ReportingPeriod`: `{ basis: 'point_in_time' \| 'trailing_twelve_months' \|
'fiscal_quarter' \| 'fiscal_year'; periodEnd: string; fiscalYear: number;
fiscalQuarter?: number }`.

`asOf`, `sourceId`, `sourceLabel`, `delivery`, `timezone`, and
`engineVersion` are required by the type — a provenance record missing any
of them does not compile.

### `DiscoveryEnvelope<T>` (`src/lib/surface/provenance.ts`, T-1008-1)

| Field | Type | Description |
|-------|------|-------------|
| `data` | `T` | the typed payload |
| `provenance` | `Provenance` | above |
| `warnings` | `string[]` | non-fatal notes, e.g. clamped limit, unconfigured source |

### Stable IDs (`src/lib/surface/ids.ts`, T-1008-1)

Namespaced strings, opaque to callers. Two families in this epic:

| Family | Form | Example |
|--------|------|---------|
| instrument | `inst:<mic>:<symbol>` | `inst:XNAS:AAPL` |
| catalog item | `<kind>.<path>` | `field.price.close`, `study.rsi`, `op.crosses_above`, `interval.1d`, `universe.sp500`, `pattern.bull_flag`, `template.momentum_breakout` |

`isInstrumentId(value)` and `isCatalogItemId(value)` let a caller detect a
bare ticker passed where an ID belongs. The instrument form is the
application's default construction only; a provider that mints its own
stable identifiers may supply them instead (spec.md Open Question 2).

### Catalog item model (`src/lib/catalog/types.ts`, T-1008-2)

Common to every item:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | stable catalog item ID |
| `kind` | `CatalogKind` | discriminant, below |
| `label` | `string` | display name |
| `description` | `string` | one line, agent-facing |
| `aliases` | `string[]` | search synonyms |
| `tags` | `string[]` | grouping/search hints |
| `availability` | `DataAvailability` | below |
| `deprecated` | `boolean \| undefined` | present when superseded |

`CatalogKind` = `'field' | 'operator' | 'study' | 'indicator' | 'pattern' |
'interval' | 'universe' | 'template'` — the eight kinds `search_catalog`
names.

`DataAvailability`:

| Field | Type | Description |
|-------|------|-------------|
| `status` | `'available' \| 'partial' \| 'unavailable'` | can an agent actually use this item today? |
| `reason` | `string \| undefined` | required when not `available` |
| `requiresReferenceData` | `boolean` | true when the item needs reference data this project has no source for |
| `intervalIds` | `string[]` | intervals the item is available over |
| `earliest` / `latest` | `string \| undefined` | ISO dates; unknown until a real data source lands |

Discriminated members:

- **`FieldItem`** — `valueType` (`'number' | 'string' | 'boolean' | 'date' |
  'enum'`), `unit?`, `enumValues?`, `range?` (`{ min?, max? }`),
  `nullable`, `reportingBasis?` (fundamentals only).
- **`OperatorItem`** — `arity`, `operandTypes: CatalogValueType[]`,
  `resultType: 'boolean'`, `conditionFamily`. The families are exactly the
  tool spec's eight `edit_filter_tree` condition types: `scalar`, `range`,
  `series_comparison`, `temporal`, `event_relative`, `pattern`, `relative`,
  `study_output`.
- **`StudyItem`** / **`IndicatorItem`** / **`PatternItem`** —
  `parameters: CatalogParameter[]`, `outputs: CatalogOutput[]`,
  `defaultIntervalId`. Study vs. indicator: see spec.md Open Question 1.
- **`IntervalItem`** — `barSeconds`, `sessionAware`.
- **`UniverseItem`** — `membershipSource`, `approximateSize?`.
- **`TemplateItem`** — `appliesTo: 'screener' | 'workspace' | 'chart'`,
  `summary`.

`CatalogParameter`: `{ name, valueType, unit?, defaultValue, range?,
enumValues?, required }`.
`CatalogOutput`: `{ name, valueType, unit?, range? }`.

### Catalog registry query surface (`src/lib/catalog/registry.ts`, T-1008-2)

**Consumed by EPIC-1009 and EPIC-1011 — treat as published.**

| Function | Signature | Description |
|----------|-----------|-------------|
| `getCatalogItem` | `(id: string) => CatalogItem \| undefined` | lookup by stable ID |
| `listCatalogItems` | `(kind?: CatalogKind) => readonly CatalogItem[]` | full inventory, or one kind |
| `searchCatalogItems` | `(query: CatalogQuery) => CatalogMatch[]` | ranked search across label, ID, aliases, tags |
| `isOperatorValidForField` | `(operatorId: string, fieldId: string) => OperatorFieldCheck` | **EPIC-1009's validation hook** — reports valid/invalid with a reason |
| `resolveStudy` | `(studyId: string) => StudyItem \| undefined` | **EPIC-1011's resolution hook** |
| `clampCatalogLimit` | `(limit?: number) => { limit, clamped }` | bounds a page to `MAX_CATALOG_RESULTS` (50), default 20 |
| `suggestCatalogIds` | `(unknownId: string, max?) => string[]` | nearest real IDs for a miss; `describe_catalog_item`'s self-correction hint |

`CatalogQuery`: `{ text?, kinds?, includeUnavailable?, limit? }`.
`CatalogMatch`: `{ item: CatalogItem, score: number, matchedOn: 'id' |
'label' | 'alias' | 'tag' | 'description' | 'enumeration' }`. `'enumeration'`
is what an empty-text kind-restricted listing reports: nothing was matched
against, so attributing the hit to a field that played no part would be a
small lie an agent would try to reason from.

Ranking is a fixed ladder (exact ID 100, exact label 90, exact alias 80,
then prefix, then substring, then tag, then description), ties broken on ID.
Deliberately predictable rather than tuned: an agent that cannot anticipate
the ordering re-queries instead of trusting it.

**What `availability` means.** It answers "can an agent use this today?",
and the `reason` says which kind of no it is — no data source, no engine
support, or no consuming tool yet. An agent that cannot tell "unsupported"
from "not wired up" retries forever. Concretely: daily OHLCV fields,
`interval.1d`, and the studies the expression engine really implements
(`sma`, `ema`, `atr`) are available; RSI/MACD/Bollinger are declared but
unavailable pending engine support; VWAP and the intraday intervals are
unavailable for want of intraday data; sector/industry/index/exchange/
country/market-cap/fundamentals fields and the index universes are
unavailable with `requiresReferenceData: true`.

Returned collections are `readonly`; the inventory is frozen at module
load. Registry **data** and registry **query logic** are separate modules so
a real data source can later contribute availability records without
touching the query surface.

### `InstrumentDirectory` (`src/lib/discovery/ports.ts`, T-1008-3)

**The integration seam for a future reference/fundamental-data source.**

```
searchInstruments(query: InstrumentQuery)
  => Promise<DiscoveryEnvelope<InstrumentMatch[]>>
getInstrument(instrumentId: string)
  => Promise<DiscoveryEnvelope<Instrument | null>>
```

`Instrument`:

| Field | Type | Description |
|-------|------|-------------|
| `instrumentId` | `string` | canonical, opaque, never a bare ticker |
| `symbol` | `string` | display ticker — identity, not identifier |
| `name` | `string` | instrument/company name |
| `exchangeId` | `string` | internal exchange ID |
| `exchangeMic` | `string` | ISO 10383 MIC |
| `assetType` | `AssetType` | `equity`, `etf`, `adr`, `fund`, `index`, `future`, `fx`, `crypto` |
| `countryCode` | `string` | ISO 3166-1 alpha-2 |
| `currency` | `string` | ISO 4217 trading currency |
| `primaryListing` | `boolean` | |
| `status` | `'active' \| 'delisted' \| 'suspended'` | |
| `isin` / `figi` | `string \| undefined` | when the provider has them |
| `listedFrom` / `listedTo` | `string \| undefined` | ISO dates |

`InstrumentQuery`: `{ text, assetTypes?, exchangeIds?, countryCodes?,
includeDelisted?, limit? }` — `limit` bounded by `MAX_INSTRUMENT_RESULTS`
(50), defaulting to `DEFAULT_INSTRUMENT_RESULTS` (10). `ports.ts` exports
`clampInstrumentLimit(limit)`, returning `{ limit, clamped }`, so adapters
and the tool layer clamp against the same number and both can warn when
they clamped rather than truncating silently.
`InstrumentMatch`: `{ instrument: Instrument, score: number, matchedOn:
'symbol' | 'name' | 'alias' | 'isin' | 'figi' }`.

`getInstrument` resolves `data: null` for an unknown ID — a not-found
outcome, never a throw and never a fabricated record.

#### Implementer's checklist (a future reference-data source)

1. Implement both methods; return `DiscoveryEnvelope`, never a bare array.
2. Populate every required `Provenance` field. For a directory sourced from
   a static export, `delivery: 'static'` with `asOf` set to the export date
   is correct and honest; do not claim `live`.
3. Set `currency` per instrument, not on the envelope — a multi-venue
   result spans currencies.
4. Return several ranked candidates when the text is ambiguous. Do not
   pre-select.
5. Mint stable `instrumentId`s, or let the application construct them per
   `ids.ts`. Either way they must survive a symbol change.
6. Honour `includeDelisted` (default false) and clamp `limit`, adding a
   warning when clamped.
7. Surface source failures as rejections; the tool layer maps them to error
   results.
8. Adapters live in infra. The port must stay free of I/O imports.

An implementer may choose HTTP against the existing FastAPI backend; if so,
the response body is the `DiscoveryEnvelope` shape above verbatim, so the
choice does not reopen the port.

### `unavailableInstrumentDirectory` (`src/lib/discovery/unavailableDirectory.ts`, T-1008-3)

Default when nothing is configured — which is every deployment today.
`createUnavailableInstrumentDirectory()` is a factory, not a module-level
singleton, so composition decides which adapter is in use. Both methods
resolve to a well-formed envelope with an empty payload (`[]` and `null`
respectively), `sourceId: 'src.instruments.unconfigured'`, `delivery:
'static'`, and a warning stating that no reference-data source is
configured. It never throws and never invents instruments. This is the
deliberate alternative to a mock instrument dataset.

A configurable test double, `createFakeInstrumentDirectory` in
`src/lib/discovery/testSupport.ts`, is what other tickets' tests drive.
It lives beside the tests, never in the shipped default path.

### `buildDiscoveryTools` (`src/lib/webmcp/discovery/group.ts`, T-1008-7)

`(deps: { directory: InstrumentDirectory; registry?: CatalogRegistry }) =>
ToolSpec[]` — returns the three specs, in the existing `ToolSpec` shape
`register.ts` already consumes. Dependencies are parameters, not
module-level singletons, so a real directory replaces the default without
editing consumers. `registry` defaults to `builtinCatalogRegistry`. All
three tools are always `available`: discovery precedes state.
`DISCOVERY_TOOL_NAMES` is exported alongside it so a composition root — and
the collision test against the existing 11-tool surface — can name the set
without instantiating it.

Whether the group is registered on the live page is the new surface's
composition root's decision. This epic wires nothing into the running app:
`register.ts`, `session.ts`, `tools.ts` and `+page.svelte` are untouched, so
the current tool count and activity log are identical whether or not the
group is composed in, and `main` stays deployable.

### Result shaping (`src/lib/webmcp/discovery/results.ts`)

`ok` / `fail` mirror `webmcp/tools.ts`'s shapes rather than importing them:
this epic ships the replacement surface alongside the one EPIC-1015 retires
and must not touch it, and a two-line JSON wrapper is a cheaper duplication
than a coupling between the two. Also here: `catalogProvenance()` (source
`src.catalog.builtin`, `delivery: 'static'`, no currency or reporting period
because a catalog entry has no monetary content) and the argument readers
each tool uses to re-check its inputs — a bridge is not obliged to enforce a
declared `inputSchema`, so the handlers validate rather than trust it.

Each tool's result carries an `outcome` discriminant so the difference an
agent most needs is machine-readable rather than buried in prose:
`search_instruments` reports `matches` / `no_matches` / `source_unavailable`,
and `search_catalog` reports `matches` / `no_matches` / `enumeration`. An
unknown ID passed to `describe_catalog_item` is an error result carrying the
ID and the nearest real IDs — the same one-turn self-correction the existing
surface gives on a bad expression — not an empty success.

## Data flow

```
agent
  │  search_instruments
  ├─────────────> InstrumentDirectory (port)
  │                 ├── unavailableInstrumentDirectory   (default, today)
  │                 └── <real reference-data adapter>        (later)
  │
  │  search_catalog / describe_catalog_item
  └─────────────> catalog registry (in-app, static)
                     ▲                    ▲
                     │                    │
       EPIC-1009 edit_filter_tree   EPIC-1011 edit_chart_studies
       (isOperatorValidForField)    (resolveStudy)
```

Every arrow back to the agent returns a `DiscoveryEnvelope`.

## Dependency direction

- `src/lib/catalog/` and `src/lib/discovery/ports.ts` are domain: no I/O
  imports, no imports from `src/lib/webmcp/`.
- `src/lib/discovery/unavailableDirectory.ts` is infra: imports the port,
  never the reverse.
- `src/lib/webmcp/discovery/` is the api layer: imports domain and infra,
  and nothing imports it back.
- Nothing in this epic imports from `src/lib/workspace/` or
  `src/lib/webmcp/tools.ts`.

---

*Product design: [spec.md](spec.md)*
