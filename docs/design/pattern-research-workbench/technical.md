# Pattern Research Workbench — Technical Design

## Contracts

The design interview surfaced three gaps against the currently implemented
types in `src/lib/webmcp/types.ts` that the query-engine tickets
(T-1001-3, T-1001-4) and integration ticket (T-1001-5) need to close:

### `InstanceEvent` — needs a completeness field

| Field | Type | Description |
|----------------|------|-------------|
| `ticker` | `string` | existing |
| `date` | `string` | existing — anchor date |
| `completeness` | `number \| undefined` | new — fraction of setup steps satisfied (0–1). Absent or `1` for a fully completed instance; present and `<1` for a partial/in-progress match |

### `InstanceSetSummary` — needs a completed/partial breakdown

| Field | Type | Description |
|----------------|------|-------------|
| `count` | `number` | existing — total instances in the set |
| `completeCount` | `number` | new |
| `partialCount` | `number` | new — `count = completeCount + partialCount` |

### `FocusState` — focus and selection must be independent fields

Current shape conflates them:
```
FocusState { panelId, selected: InstanceEvent[] }
```
Needed shape — `focusInstance` (agent-driven) must not mutate `selected`
(human-driven):

| Field | Type | Description |
|----------------|------|-------------|
| `panelId` | `string` | existing |
| `selected` | `InstanceEvent[]` | existing — human multi-select, set only via direct UI interaction |
| `focusedInstance` | `InstanceEvent \| null` | new — set only via `focusInstance`, independent of `selected` |

### `MeasureResult` — needs an exclusion note

| Field | Type | Description |
|----------------|------|-------------|
| `excludedPartialCount` | `number \| undefined` | new — present when the input set contained partial instances that were excluded from the statistic |

### `PriceBar` — backend panel row schema (T-1001-1)

`backend/domain/models/price.py`. One adjusted daily OHLCV row — the
shared schema the mock generator and the real EODHD pipeline (T-1001-9)
both must produce, so swapping one panel for the other requires no
downstream code changes.

| Field | Type | Description |
|----------------|------|-------------|
| `ticker` | `str` | |
| `date` | `date` | |
| `open` | `float` | adjusted |
| `high` | `float` | adjusted |
| `low` | `float` | adjusted |
| `close` | `float` | adjusted |
| `volume` | `int` | |

### `SpikePingResponse` — throwaway spike DTO (T-1001-2)

`backend/api/schemas/spike.py`. Proves a WebMCP tool's `execute()` can
reach a live deployed backend. Superseded by the real tool endpoints wired
in T-1001-5 — not part of the permanent API surface.

| Field | Type | Description |
|----------------|------|-------------|
| `message` | `str` | |
| `sample` | `PriceBar` | one row read from the mock panel |

### `PatternResearchEngine` — query engine contract (T-1001-3, extended by T-1001-4)

`backend/domain/contracts/engine.py`. Implemented by a pandas/numpy infra
adapter; a `MockPatternResearchEngine` fake lives in
`backend/tests/mocks/` for callers' tests.

| Method | Signature | Description |
|----------------|------|-------------|
| `define_study` | `(name, expression) -> Study` | raises `ExpressionError` (with catalog) on an unsupported function |
| `define_setup` | `(name, steps) -> Setup` | |
| `find_instances` | `(setup, from_date, to_date, min_market_cap, sectors) -> InstanceSet` | applies the partial-match fallback and dedup rules from `spec.md` |

### `Study`, `SetupStep`, `Setup` — pattern domain models (T-1001-3)

`backend/domain/models/pattern.py`. Backend-side mirror of the frontend's
`StudySummary`/`SetupStep`/`SetupSummary` types.

### `Instance`, `InstanceSet` — result domain models (T-1001-3)

`backend/domain/models/instance.py`. `InstanceSet.complete_count` /
`partial_count` are stored fields (not derived), matching the
`InstanceSetSummary` breakdown documented above.

## Data Flow

Partial-match fallback happens inside `findInstances` only — sampling,
measuring, splitting, and grid rendering all operate on whatever mix of
complete/partial instances they're handed; only `measure` (and by
extension anything relying on a resolved outcome) needs to filter partials
out internally.

The partial-match threshold (fewer than 5 completed matches triggers
inclusion of partials) and the completion score formula (fraction of
setup steps satisfied) are behavioral decisions made in this spec, not
implementation details — see `spec.md`'s "Instance search" scenarios. Do
not re-derive or change them without updating the spec first.

---

*Product design: [spec.md](spec.md)*
