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
