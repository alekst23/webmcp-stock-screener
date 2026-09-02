# Screener Core — Technical Design

This document fixes the shapes EPIC-1009 owns and the two contracts other
epics consume: the **screener definition** (edited by the five mutation
tools) and the **pinned run** (produced by `run_screener`, consumed by
EPIC-1010's `get_screener_results`, EPIC-1007's `set_panel_selection`
(retired `select_result`'s standalone form; selection now runs through
the generic panel tool), and `explain_result`).

Every mutation tool here accepts `expected_revision` and
`idempotency_key` and returns EPIC-1006's mutation envelope
(`change_id`, `new_revision`, `affected_ids`, `diff_summary`, `warnings`,
`undo_token`). That envelope is **not** redefined here — it is consumed
from EPIC-1006, as is the provenance type referenced below. Catalog item
identity, parameters, units, valid ranges, declared outputs, and data
availability are consumed from EPIC-1008's registry and are likewise not
redefined here.

## Stable ID conventions

| Prefix | Names | Minted by |
|--------|-------|-----------|
| `scr_` | a screener | `create_screener` |
| `fnode_` | one filter-tree node (condition or group) | `edit_filter_tree` |
| `run_` | one pinned execution of one screener revision | `run_screener` |

A node ID is stable for the life of the node: grouping, reordering,
enabling, and disabling never re-mint one. Removing a node retires its ID
permanently — it is never reused within the same screener.

## Screener definition

| Field | Type | Description |
|-------|------|-------------|
| `screener_id` | `string` | stable `scr_` ID; the only way to address the screener |
| `workspace_id` | `string` | workspace this screener is bound to |
| `name` | `string \| null` | display label only, never an address |
| `revision` | `integer` | screener-local revision, starts at 1, advances on every accepted mutation |
| `universe` | `UniverseSpec` | what the screener may consider |
| `filter_tree` | `FilterNode` | root group; an empty root means "no conditions" |
| `ranking` | `RankingSpec \| null` | `null` means the documented default order |

### `UniverseSpec`

| Field | Type | Description |
|-------|------|-------------|
| `asset_class` | `string` | catalog asset class |
| `exchanges` | `string[]` | catalog exchange IDs |
| `countries` | `string[]` | catalog country IDs |
| `sectors` | `string[]` | catalog sector IDs |
| `industries` | `string[]` | catalog industry IDs |
| `indexes` | `string[]` | catalog index IDs |
| `watchlists` | `string[]` | watchlist IDs |
| `liquidity` | `LiquidityLimits` | minimum price, average volume, market cap |
| `exclusions` | `Exclusions` | instrument, sector, and industry IDs removed after inclusion |

Inclusion criteria union; `liquidity` and `exclusions` then subtract.
Exclusions always win over inclusions.

### `FilterNode`

A discriminated union on `kind`.

| `kind` | Shape |
|--------|-------|
| `group` | `{ node_id, kind: 'group', op: 'and' \| 'or' \| 'not', children: FilterNode[], enabled }` |
| `condition` | `{ node_id, kind: 'condition', condition: Condition, enabled }` |

`op: 'not'` accepts exactly one child. A disabled node stays in the tree
and is skipped by both validation and execution.

### `Condition`

A discriminated union on `type`, one variant per condition type in
`docs/reference/tool-spec.md`. No variant carries a free-form string that is
parsed or evaluated — that is what makes "no raw SQL or JavaScript" an
enforceable property of the model rather than a review convention.

| `type` | Carries |
|--------|---------|
| `scalar` | `field_id`, `operator`, `value`, `unit` |
| `range` | `field_id`, `lower`, `upper`, `lower_inclusive`, `upper_inclusive` |
| `series_comparison` | `left` and `right` series refs (each `catalog_id` + params), `operator` |
| `temporal` | inner `Condition`, `event` (`crossed_above`, `crossed_below`, `became_true`), `within_bars`, `interval_id` |
| `event_relative` | `event_type_id`, `direction` (`past` \| `future`), `window_days` |
| `pattern` | `pattern_id`, `min_confidence`, `interval_id` |
| `relative` | `field_id`, `baseline` (own moving average, peer group, or index ref), `multiple`, `operator` |
| `study_output` | `study_id`, `params`, `output_name`, `predicate` (e.g. `positive_and_rising`) |

### `RankingSpec`

| Field | Type | Description |
|-------|------|-------------|
| `fields` | `RankingField[]` | `{ field_id, direction, weight }`; one entry ranks by that field alone |
| `tie_break` | `{ field_id, direction } \| null` | resolves equal composite scores |
| `limit` | `integer` | maximum matches returned by a run |
| `normalization` | `string` | how differing units are made comparable before weighting (see spec.md Open Question 3) |

## Pinned run — the EPIC-1010 contract

`run_screener` executes one screener revision and stores the ordered,
complete match list under a `run_id`. EPIC-1010 reads pages out of that
stored run. **A read never re-executes**: if the run is gone, the read
fails explicitly rather than silently producing fresh numbers under an
old handle.

### `ScreenerRun` (returned by `run_screener`, addressed by `run_id`)

| Field | Type | Description |
|-------|------|-------------|
| `run_id` | `string` | stable `run_` ID; the handle EPIC-1010 pages against |
| `screener_id` | `string` | screener executed |
| `screener_revision` | `integer` | the exact revision executed — later edits do not change it |
| `status` | `'complete' \| 'refused'` | `refused` when blocking validation problems prevented execution; no `run_id` is minted in that case |
| `universe_count` | `integer` | instruments in the universe after liquidity limits and exclusions |
| `matched_count` | `integer` | instruments satisfying the filter tree, before the result limit |
| `returned_count` | `integer` | matches actually stored in the run, after the limit |
| `truncated` | `boolean` | `returned_count < matched_count` |
| `ranking_applied` | `boolean` | `false` when the screener had no ranking and the default order was used |
| `warnings` | `Warning[]` | non-blocking problems: empty result, degraded data coverage, cost estimate exceeded |
| `provenance` | `Provenance` | EPIC-1006's provenance type — see below |

### `Provenance` on every run

Consumed from EPIC-1006; a run must populate all of it:
`as_of`, `source`, live/delayed status, `timezone`, `currency`, price
adjustment (adjusted or unadjusted), the fundamentals reporting period
backing any fundamental field used, and the calculation-engine version.
This is what makes a `run_id` citable later — the same handle always
describes the same data under the same engine.

### What the run stores for EPIC-1010

Beyond the summary above, a run retains, per matched instrument, in
ranked order: the instrument ID, its rank and composite score, the value
of every ranking field, and the evaluated value and pass/fail state of
every enabled filter node keyed by `node_id`. That last part is what
makes EPIC-1010's `explain_result` a lookup rather than a re-evaluation.

## Boundaries

- **Definition editing is workspace state.** `create_screener`,
  `set_screener_universe`, `edit_filter_tree`, and `set_screener_ranking`
  mutate the screener definition and require no market data, so they stay
  in the browser-side surface alongside the workspace model, mirroring
  the existing client-side/networked tool split (`docs/plan.md`,
  `src/lib/webmcp/tools.ts`).
- **Validation and execution need data.** `validate_screener` and
  `run_screener` consult catalog data availability and the market-data
  ports, so evaluation lives behind a domain port in the Python backend,
  following `backend/domain/contracts/engine.py`'s existing
  Protocol-plus-infra-adapter pattern. Domain never imports from infra.
- **Nothing here modifies the existing surface.** All work lands in new
  files beside `src/lib/webmcp/tools.ts`, `src/lib/workspace/store.ts`,
  and `backend/infra/pandas_engine.py`. EPIC-1015 retires the old surface
  later.

---

*Product design: [spec.md](spec.md)*
