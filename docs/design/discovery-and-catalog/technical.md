# Discovery & Catalog — Technical Design

Contracts introduced by EPIC-1008. Two of them are consumed outside this
epic and should be treated as published:

- **The catalog registry query surface** — EPIC-1009 (`edit_filter_tree`)
  validates conditions against it; EPIC-1011 (`edit_chart_studies`)
  resolves study IDs through it.
- **`InstrumentDirectory`** — the integration seam the separate
  reference/fundamental-data workstream implements against.

Everything here lives in **new files**. `src/lib/webmcp/tools.ts`,
`src/lib/webmcp/types.ts`, `src/lib/webmcp/register.ts`, and
`src/lib/workspace/*` are not modified by this epic.

## Module layout

| Module | Layer | Contents |
|--------|-------|----------|
| `src/lib/surface/provenance.ts` | domain | `DiscoveryEnvelope`, `Provenance`, engine version (T-1008-1) |
| `src/lib/surface/ids.ts` | domain | stable-ID construction and validation (T-1008-1) |
| `src/lib/catalog/types.ts` | domain | catalog item type model (T-1008-2) |
| `src/lib/catalog/registry.ts` | domain | seeded inventory + query surface (T-1008-2) |
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
| `status` | `'available' \| 'partial' \| 'unavailable'` | |
| `reason` | `string \| undefined` | required when not `available` |
| `requiresReferenceData` | `boolean` | true when the live-data workstream must supply it |
| `intervalIds` | `string[]` | intervals the item is available over |
| `earliest` / `latest` | `string \| undefined` | ISO dates; unknown until the live-data workstream lands |

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

`CatalogQuery`: `{ text?, kinds?, includeUnavailable?, limit? }`.
`CatalogMatch`: `{ item: CatalogItem, score: number, matchedOn: 'id' |
'label' | 'alias' | 'tag' | 'description' }`.

Returned collections are `readonly`; the inventory is frozen at module
load. Registry **data** and registry **query logic** are separate modules so
the live-data workstream can later contribute availability records without
touching the query surface.

### `InstrumentDirectory` (`src/lib/discovery/ports.ts`, T-1008-3)

**The integration seam for the reference/fundamental-data workstream.**

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
includeDelisted?, limit? }` — `limit` bounded by a documented maximum.
`InstrumentMatch`: `{ instrument: Instrument, score: number, matchedOn:
'symbol' | 'name' | 'alias' | 'isin' | 'figi' }`.

`getInstrument` resolves `data: null` for an unknown ID — a not-found
outcome, never a throw and never a fabricated record.

#### Implementer's checklist (reference-data workstream)

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

The workstream may implement this over HTTP against the existing FastAPI
backend; if so, the response body is the `DiscoveryEnvelope` shape above
verbatim, so the choice does not reopen the port.

### `unavailableInstrumentDirectory` (`src/lib/discovery/unavailableDirectory.ts`, T-1008-3)

Default when nothing is configured. Both methods resolve to a well-formed
envelope with an empty payload, `sourceId: 'src.instruments.unconfigured'`,
`delivery: 'static'`, and a warning naming the reference-data dependency.
It never throws and never invents instruments. This is the deliberate
alternative to a mock instrument dataset.

### `buildDiscoveryTools` (`src/lib/webmcp/discovery/group.ts`, T-1008-7)

`(deps: { directory: InstrumentDirectory; registry?: CatalogRegistry }) =>
ToolSpec[]` — returns the three specs, in the existing `ToolSpec` shape
`register.ts` already consumes. Dependencies are parameters, not
module-level singletons, so a real directory replaces the default without
editing consumers. All three tools are always `available`: discovery
precedes state.

## Data flow

```
agent
  │  search_instruments
  ├─────────────> InstrumentDirectory (port)
  │                 ├── unavailableInstrumentDirectory   (default, today)
  │                 └── <reference-data workstream adapter>  (later)
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
