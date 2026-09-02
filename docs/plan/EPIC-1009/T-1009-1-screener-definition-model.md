# T-1009-1: Screener definition model and typed filter tree

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: —
**Blocks**: T-1009-3, T-1009-4, T-1009-5

## Description

Every other ticket in this epic edits, validates, or executes the same
thing: a screener definition. This ticket introduces that definition as a
typed, browser-side model — the screener entity, its universe selection,
its filter tree, and its ranking — plus the stable-ID minting and
normalization the editing tools depend on. No tools and no evaluation
yet; this is the shape everything else agrees on.

## User Story

As a developer implementing the screener editing tools,
I want one typed screener model with stable IDs and safe normalization,
so that each editing tool changes state rather than inventing its own
representation of it.

## Acceptance Criteria

1. A screener can be represented with a stable ID, an owning workspace ID,
   an optional display name, a screener-local revision starting at 1, a
   universe selection, a filter tree, and an optional ranking.
2. The universe selection can carry asset class, exchanges, countries,
   sectors, industries, indexes, watchlists, liquidity limits (minimum
   price, minimum average volume, minimum market cap), and exclusions of
   instruments, sectors, and industries.
3. A filter tree node is either a group (`AND`, `OR`, or `NOT`, holding
   ordered children) or a condition, each with a stable node ID and an
   enabled/disabled flag; groups nest to arbitrary depth and a `NOT` group
   holds exactly one child.
4. Each of the eight condition types from the design spec is representable
   as its own typed variant, distinguishable at runtime without inspecting
   its contents.
5. No part of the model has a field capable of carrying SQL, JavaScript,
   or a free-form expression that would later be parsed or evaluated.
6. Minting a screener ID or node ID produces a value that is unique within
   its workspace and never collides with a previously retired ID in the
   same screener.
7. A malformed, foreign, or partially-corrupt serialized screener is
   normalized into a valid screener without throwing, matching the
   resilience the existing workspace persistence already provides.
8. A screener round-trips through serialization and normalization
   unchanged, including node IDs, node order, enabled flags, and nesting.
9. Unit tests cover each condition variant, arbitrary nesting, the `NOT`
   arity rule, ID uniqueness, and normalization of corrupt input.

## Design References

- `docs/design/screener-core/technical.md` — the definition, node, and
  condition shapes this ticket makes concrete, and the stable-ID prefixes.
- `docs/design/screener-core/spec.md` — "Create a screener", "Set the
  universe", and "Express eight condition types" scenarios.
- `src/lib/webmcp/types.ts` — the existing handle-based model style
  (summaries addressed by `id`) to follow.
- `src/lib/workspace/store.ts` — the existing `normalizeWorkspace`
  never-throw normalization pattern this mirrors.

## Technical Considerations

- New files only, beside the existing `src/lib/webmcp` and
  `src/lib/workspace` modules. Do not modify `types.ts`, `tools.ts`, or
  `store.ts`.
- Workspace IDs, revisions, and the mutation envelope come from EPIC-1006
  — reference them, do not re-declare them here.
- Catalog item identity (field, operator, study, pattern, interval IDs)
  comes from EPIC-1008. This ticket stores those IDs; it does not validate
  them (T-1009-6 does).

## Out of Scope

Tools, catalog validation, evaluation, and persistence wiring.

## Solution Approach

**Location note:** this epic is implemented entirely in browser-side
TypeScript under `src/lib/screener/`, not in `backend/`. EPIC-1006 and
EPIC-1008 both landed their contracts in TypeScript
(`src/lib/workbench/domain/`, `src/lib/catalog/`), and EPIC-1010 will
consume this epic's contracts from TypeScript too. The ticket's and
technical.md's references to `backend/domain/...` and the `scr_`/`fnode_`
ID prefixes describe the domain-port/infra-adapter *pattern*, not the
location or ID scheme actually used — EPIC-1006's `src/lib/workbench/domain/ids.ts`
already owns the `screener` and `filter` resource kinds, and its
sequencer is reused unchanged.

### Modules

**`src/lib/screener/definition.ts`**

Exported types:
- `ScreenerDefinition { screenerId: ResourceId; workspaceId: ResourceId; name: string | null; revision: Revision; universe: UniverseSpec; filterTree: FilterNode; ranking: RankingSpec | null }`
- `UniverseSpec { assetClass: string; exchanges: string[]; countries: string[]; sectors: string[]; industries: string[]; indexes: string[]; watchlists: string[]; liquidity: LiquidityLimits; exclusions: Exclusions }`
- `LiquidityLimits { minPrice: number | null; minAverageVolume: number | null; minMarketCap: number | null }`
- `Exclusions { instrumentIds: string[]; sectorIds: string[]; industryIds: string[] }`
- `FilterNode = GroupNode | ConditionNode`
- `GroupNode { nodeId: ResourceId; kind: 'group'; op: 'and' | 'or' | 'not'; children: FilterNode[]; enabled: boolean }`
- `ConditionNode { nodeId: ResourceId; kind: 'condition'; condition: Condition; enabled: boolean }`
- `RankingSpec { fields: RankingField[]; tieBreak: { fieldId: string; direction: 'asc' | 'desc' } | null; limit: number; normalization: string }`
- `RankingField { fieldId: string; direction: 'asc' | 'desc'; weight: number }`

Exported functions:
- `emptyUniverse(): UniverseSpec` — the default universe `create_screener` starts with.
- `emptyFilterTree(nodeId: ResourceId): GroupNode` — an empty root `and` group.
- `createScreener(ids: IdSequencer, workspaceId: ResourceId, name: string | null): ScreenerDefinition` — mints the screener ID and the empty root group's node ID off the same sequencer, satisfying AC6 (never reuses a retired number because the sequencer is monotonic per kind).
- `isNotArityValid(node: GroupNode): boolean` — `op !== 'not' || children.length === 1`, exposed as its own predicate per AC3/AC9 rather than folded silently into normalization.
- `normalizeScreener(value: unknown): ScreenerDefinition` — never throws; mirrors `normalizeWorkspace`'s style: unrecognized shapes fall back to safe defaults, arrays drop non-parsing entries, `not` groups with `children.length !== 1` are repaired by keeping only the first child; a `not` group with zero children (no child to keep) is repaired to `op: 'and'` with zero children rather than being dropped, since dropping would silently delete a node ID the caller may still reference — see `conditions.ts` for the child-condition/group repair helpers.
- `normalizeUniverse(value: unknown): UniverseSpec`, `normalizeLiquidityLimits`, `normalizeExclusions`, `normalizeRanking` — internal normalization helpers, exported for reuse by `conditions.ts` tests only if needed.

**`src/lib/screener/conditions.ts`** (split out because `definition.ts` alone comfortably fits, but the eight-variant `Condition` union plus its normalization is a distinct, sizeable concern)

Exported types:
- `Condition` — discriminated union on `type`, one member per `ConditionFamily` from `src/lib/catalog/types.ts`: `ScalarCondition`, `RangeCondition`, `SeriesComparisonCondition`, `TemporalCondition`, `EventRelativeCondition`, `PatternCondition`, `RelativeCondition`, `StudyOutputCondition`. Each field is a catalog ID (string), enum member, or number/boolean — never a field that could carry an expression to parse. `TemporalCondition.condition` nests an inner `Condition` (recursive), matching technical.md's "temporal wraps an inner condition".
- `SeriesRef { catalogId: string; params: Record<string, number | string | boolean> }`
- `RelativeBaseline = { kind: 'own_moving_average'; windowBars: number } | { kind: 'peer_group'; groupId: string } | { kind: 'index'; indexId: string }`

Exported functions:
- `normalizeCondition(value: unknown): Condition | null` — returns `null` (never throws) for an unrecognized `type` or structurally invalid payload; the caller (`normalizeScreener`'s condition-node repair) drops the enclosing `ConditionNode` when this returns `null`.
- `CONDITION_FIELD_ALLOWLIST: Record<ConditionFamily, readonly string[]>` — the documented list of field names each condition variant may carry. Used by the AC5 structural test: constructing one sample of each variant and asserting `Object.keys(sample)` is a subset of the allowlist for that variant's `type`, so a future `expression: string` field added to any variant fails the test.

**`src/lib/screener/state.ts`**

- `SCREENER_EXTENSION_KEY = 'screener'` — the key under `WorkspaceDocument.extensions`.
- Stored shape: `extensions.screener` is `Record<ResourceId, unknown>` (screener ID → raw screener value), normalized on every read so a corrupt persisted entry never propagates.
- `readScreeners(doc: WorkspaceDocument): ScreenerDefinition[]` — reads `doc.extensions[SCREENER_EXTENSION_KEY]`, normalizes every entry via `normalizeScreener`, returns in insertion order.
- `readScreener(doc: WorkspaceDocument, screenerId: ResourceId): ScreenerDefinition | null` — `null` if absent or normalizes to an ID that does not match.
- `writeScreener(doc: WorkspaceDocument, screener: ScreenerDefinition): WorkspaceDocument` — pure; returns a new `WorkspaceDocument` with a new `extensions` object and a new `extensions.screener` map (shallow-cloned, not mutating `doc` or its nested objects), with `screener` normalized before storing and keyed by `screener.screenerId`. Other `extensions` keys pass through by reference (untouched, per `workspace.ts`'s documented sibling-extension contract).
- `removeScreener(doc: WorkspaceDocument, screenerId: ResourceId): WorkspaceDocument` — pure; returns a new document with that key removed from the screener map; a no-op copy if the ID was not present.

### Test plan

`definition.test.ts`:
- `createScreener` mints distinct, sequencer-stable screener and root-node IDs; a second `createScreener` call on the same sequencer never repeats an ID even after the first screener's nodes are conceptually "removed" (AC6 — simulated by minting several more IDs and asserting no collisions).
- Arbitrary nesting: build a 4-level-deep group tree and normalize it; structure survives.
- `NOT` arity: a `not` group with 0, 1, and 2+ children — normalization repairs to exactly the arity rule states, never throwing; `isNotArityValid` predicate matches.
- Normalization of corrupt input: `undefined`, `null`, arrays, wrong-typed fields, unknown `kind`, unknown group `op`, missing `nodeId`, deeply malformed nested children — every case returns a valid `ScreenerDefinition`, never throws.
- Round-trip: build a representative screener with all eight condition types nested under mixed `and`/`or`/`not` groups, run it through `JSON.parse(JSON.stringify(...))` then `normalizeScreener`, deep-equal the original.
- Enabled flags and node order survive normalization.

`conditions.test.ts`:
- One test per condition variant: construct a valid sample, assert `normalizeCondition` round-trips it and the discriminant `type` matches.
- AC5 structural test: for each `ConditionFamily`, construct a sample `Condition` of that variant and assert every own-enumerable key is in `CONDITION_FIELD_ALLOWLIST[type]` — a variant with a stray `expression`/`sql`/`js` field fails.
- `normalizeCondition` drops unrecognized `type` values and structurally-broken payloads (`null` return), never throws.

`state.test.ts`:
- `readScreeners` on a document with no `extensions.screener` key returns `[]`.
- `writeScreener` on an empty document creates `extensions.screener`, is retrievable via `readScreener`, and does not mutate the argument document (assert the original object reference's `extensions` is unchanged).
- `writeScreener` twice with different screener IDs preserves both; writing the same ID again replaces it without disturbing others.
- `removeScreener` removes only the named screener and leaves unrelated `extensions` keys (a fake sibling key) untouched, verifying `workspace.ts`'s "unknown keys survive" contract from the screener module's side.
- A corrupt `extensions.screener` entry (e.g. a string instead of an object) is dropped by `readScreeners`/normalized rather than throwing.
