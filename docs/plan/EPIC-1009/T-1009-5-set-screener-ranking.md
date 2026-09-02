# T-1009-5: `set_screener_ranking` tool

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: T-1009-1
**Blocks**: T-1009-8

## Description

A screen that matches 400 instruments is not an answer until they are
ordered. This tool sets how matches are ranked — by one field or a
weighted combination of several — how ties are broken, and how many
results a run returns.

## User Story

As an AI agent presenting a screen to a human,
I want to declare how matches are ordered and how many come back,
so that the top of the list is the part worth their attention and the
ordering is one I can explain.

## Acceptance Criteria

1. Ranking by a single field with a direction is accepted and stored, and
   the stored ranking is echoed back in full.
2. Ranking by several fields with weights is accepted; the weights are
   stored as given and the normalization used to make differing units
   comparable is stated in the stored ranking.
3. A tie-break field and direction can be declared, and are stored as part
   of the ranking.
4. A result limit can be declared and is stored as part of the ranking.
5. A ranking naming a field not present in the catalog registry is
   rejected, naming the unknown field, and the previously stored ranking
   is left unchanged.
6. A ranking with a non-positive result limit, or with weights that cannot
   be normalized (for example all zero), is rejected with an explanation.
7. Clearing the ranking is possible and leaves the screener in the
   documented "no ranking set" state, which a run reports as ranking not
   applied.
8. The tool accepts `expected_revision` and `idempotency_key`, rejects a
   stale revision without mutating, returns the original result on a
   replayed key, advances the screener revision on acceptance, and returns
   the mutation envelope with an undo token.
9. Tests cover single-field ranking, weighted ranking, tie-break and
   limit storage, unknown field rejection, invalid limit and weights,
   clearing, and revision conflict.

## Design References

- `docs/design/screener-core/spec.md` — the "Set ranking" scenario table,
  and Open Question 3 on normalization.
- `docs/design/screener-core/technical.md` — the `RankingSpec` shape.

## Technical Considerations

- This ticket stores and validates the ranking declaration. Actually
  ordering matches by it happens in the evaluation engine (T-1009-7).
- Field existence checks go through EPIC-1008's catalog registry; the
  mutation envelope comes from EPIC-1006.

## Out of Scope

Applying the ranking to results (T-1009-7), validation reporting
(T-1009-8), and registration (T-1009-10).

## Solution Approach

### Modules

- `src/lib/screener/ranking.ts` (new, domain layer, no imports from
  `src/lib/webmcp/`). Pure validation/normalization of a ranking
  declaration that has already been parsed into camelCase. Deliberately
  does **not** import the catalog registry -- field existence and the
  numeric-field check (AC5) need the registry, which lives at the tool
  layer, so those checks happen in `setScreenerRanking.ts` before this
  module is called.
  - `RankingFieldInput`, `RankingTieBreakInput`, `RankingDeclarationInput`
    -- the pre-catalog-check input shape.
  - `RankingValidationResult` -- `{ ok: true; ranking: RankingSpec } | { ok: false; issues: string[] }`.
  - `isClearRankingInput(input): boolean` -- true when `fields` is absent,
    `null`, or `[]` (AC7's "clear" signal).
  - `canNormalizeWeights(fields): boolean` -- false when every field's
    weight is non-finite or non-positive (AC6).
  - `validateRankingDeclaration(input): RankingValidationResult` -- builds
    a `RankingSpec` (fields with default direction `desc` and default
    weight `1`, tie-break, limit defaulting to 100, normalization
    defaulting to `'percentile_rank'`), rejecting a non-positive/non-integer
    limit or unnormalizable weights with an actionable message. Never
    called for a clearing input.
  - Reuses `definition.ts`'s `RankingSpec`/`RankingField`/`RankingTieBreak`
    unchanged. Extends `definition.ts` in place (the one file this ticket
    may touch besides its own doc) to turn `RankingSpec.normalization` from
    a free-form `string` into a closed union `RankingNormalization =
    'percentile_rank' | 'z_score' | 'min_max'`, with
    `DEFAULT_RANKING_NORMALIZATION` and `RANKING_NORMALIZATIONS` exported
    alongside, and `normalizeRanking` repairing a foreign/unrecognized
    value to the default instead of keeping it verbatim.

- `src/lib/webmcp/screener/setScreenerRanking.ts` (new, API layer). The
  `set_screener_ranking` tool.
  - `createSetScreenerRankingTool(deps: WorkbenchDeps, registry: CatalogRegistry = builtinCatalogRegistry): ToolSpec`
    -- takes `WorkbenchDeps` per the epic's tool-factory contract, plus the
    catalog registry as a second, defaulted parameter (mirroring
    `webmcp/discovery/group.ts`'s `registry?: CatalogRegistry` pattern),
    since `WorkbenchDeps` itself carries no catalog handle.
  - Parses the snake_case wire input into `RankingDeclarationInput`.
  - Resolves the workspace (private `resolveWorkspaceId`, mirroring
    `workbench/tools/index.ts`'s), loads the screener via
    `readScreener`, 404s if either is missing.
  - If `isClearRankingInput` is true, skips catalog validation entirely
    and sets `ranking: null`.
  - Otherwise checks every named field (`fields[].field_id` and
    `tie_break.field_id`) against `registry.getCatalogItem` -- rejects an
    unknown field naming it with `registry.suggestCatalogIds` suggestions
    (AC5), and rejects a field that exists but is not `kind: 'field'` with
    `valueType: 'number'` (design point: ranking fields must be numeric).
    Only after every named field passes does it call
    `validateRankingDeclaration` for the structural checks (AC6).
  - On success, routes the mutation through
    `recordCommit(historyDeps(deps), { mutate: (doc) => ... })`, EPIC-1006's
    single write path: `mutate` re-reads the screener from the document
    passed in by `RevisionService.commit` (not the earlier pre-check read),
    replaces `ranking`, advances the **screener's own** `revision` (a
    counter independent of `WorkspaceDocument.revision`, which
    `RevisionService.commit` advances itself), and writes the updated
    screener back via `writeScreener`. Supplies an `inverse` draft (the
    prior whole document) so every accepted call carries an undo token
    (AC8).
  - A rejected call (unknown field, non-numeric field, bad limit,
    unnormalizable weights) returns before `recordCommit` is ever called,
    so nothing is written, no revision advances, and the previously stored
    ranking stands untouched (AC5, AC6).
  - Response echoes the mutation envelope plus `screener_id`,
    `screener_revision`, and the ranking as actually stored (re-read from
    the repository after commit), snake_cased inline
    (`toWireRanking`) -- the wire shape a run's own report
    (`run.ts`'s `normalization` field) must stay legible against.
  - Reuses, without modifying: `readScreener`/`writeScreener`
    (`screener/state.ts`), `recordCommit` (`changeHistory.ts`),
    `toWireEnvelope` (`mutation.ts`), the typed errors in
    `workbench/domain/errors.ts`, and `builtinCatalogRegistry` /
    `CatalogRegistry` (`catalog/registry.ts`).

### Test plan

`src/lib/screener/ranking.test.ts` (domain, no catalog/workbench deps):
single-field default direction/weight; weighted fields stored as given;
default and explicit normalization; unrecognized normalization repairs to
the default; tie-break stored / absent stores null; explicit and default
limit; non-positive and non-integer limit rejected; all-zero, all-negative,
and non-finite weights rejected; blank `field_id` rejected;
`isClearRankingInput` for missing/null/empty/populated `fields`;
`canNormalizeWeights` direct cases.

`src/lib/webmcp/screener/setScreenerRanking.test.ts` (tool, built on real
EPIC-1006 pieces -- `createIdSequencer`, `createIdempotencyCache`,
`createRevisionService`, `createChangeHistory`, `createOperationRegistry`,
`createLocalWorkspaceRepository(memoryStorage())` -- plus a screener
created directly via `createScreener`/`writeScreener` against the
in-memory repository, matching `workbench/tools/index.test.ts`'s fixture
style): single-field ranking accepted and echoed back in full; weighted
ranking with normalization stated in the result; tie-break and limit
storage; unknown catalog field rejected naming it with suggestions and
leaving the prior ranking unchanged; non-numeric field (e.g.
`field.symbol`) rejected; non-positive/non-integer limit rejected;
unnormalizable weights rejected; clearing sets `ranking: null`; stale
`expected_revision` rejected as a revision conflict without mutating;
repeated `idempotency_key` replays the original envelope; accepted calls
advance the screener's own revision and the workspace revision, and return
a redeemable `undo_token`.
