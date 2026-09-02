# T-1009-3: `create_screener` and `set_screener_universe` tools

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Done
**Depends on**: T-1009-1
**Blocks**: T-1009-10

## Description

The first two tools an agent calls: mint a screener bound to the
workspace, then decide what it is allowed to look at. These belong
together because a newly created screener is useless until its universe
is set, and both operate purely on the definition model with no market
data involved.

## User Story

As an AI agent starting a screen,
I want to create a screener and tell it which instruments are in play,
so that every filter I add afterwards is evaluated against a universe the
human can see and I can name.

## Acceptance Criteria

1. Creating a screener returns a stable screener ID, binds the screener to
   the active workspace, and starts it at screener revision 1 with an
   empty filter tree and a default universe.
2. An optional name supplied at creation is stored and echoed back, and is
   never accepted as a way to address the screener afterwards.
3. Setting the universe replaces the previous selection wholesale with the
   supplied asset class, exchanges, countries, sectors, industries,
   indexes, and watchlists, and advances the screener revision.
4. Liquidity limits — minimum price, minimum average volume, minimum
   market cap — are stored with the universe and documented as applying
   before any filter condition.
5. Exclusions of instruments, sectors, or industries remove those members
   even when another inclusion criterion would have added them.
6. A universe naming an exchange, country, sector, industry, or index that
   is not in the catalog registry is rejected, naming every unrecognized
   value, and the previous universe is left unchanged.
7. A universe selection that resolves to zero instruments is still
   applied, but the response carries a warning that the universe is empty.
8. Both tools accept `expected_revision` and `idempotency_key`; a stale
   `expected_revision` is rejected as a revision conflict without
   mutating and reports the current revision, and a replayed
   `idempotency_key` returns the original result without acting again.
9. Both tools return the mutation envelope with `affected_ids` naming the
   screener and a `diff_summary` describing what changed, and both are
   reversible via the returned undo token.
10. Tests cover creation, wholesale universe replacement, exclusions
    beating inclusions, unknown catalog members, the empty-universe
    warning, revision conflict, and idempotent replay.

## Design References

- `docs/design/screener-core/spec.md` — "Create a screener" and "Set the
  universe" scenario tables; every AC above traces to a row there.
- `docs/design/screener-core/technical.md` — `UniverseSpec` shape and the
  inclusion/subtraction ordering.
- `src/lib/webmcp/tools.ts` — the existing `ToolSpec` shape, tool
  description style, and `ok`/`fail` result helpers to follow.

## Technical Considerations

- The mutation envelope, `expected_revision` handling, `idempotency_key`
  replay, and undo tokens are EPIC-1006's; call into that contract rather
  than reimplementing any of it.
- Catalog membership checks go through EPIC-1008's registry.
- Tools go in new files beside `src/lib/webmcp/tools.ts`, which is not
  modified. Registration with the WebMCP surface is T-1009-10.

## Out of Scope

Filter conditions (T-1009-4, T-1009-6), ranking (T-1009-5), validation
(T-1009-8), execution (T-1009-9), and tool registration (T-1009-10).

## Solution Approach

### Modules

- `src/lib/screener/universeValidation.ts` (new, domain layer) — pure
  functions that interpret a `UniverseSpec` against the catalog registry
  and an optional resolved-size signal. No I/O, no imports from
  `src/lib/webmcp/`.
  - `checkUniverseCatalogMembership(universe, catalog): { unknownIndexIds: string[]; suggestionsByIndex: Record<string, string[]>; unverifiableWarning: string | null }`
    — validates `universe.indexes` entries against
    `catalog.getCatalogItem(id)?.kind === 'universe'` (the only catalog
    kind that models index membership; there is no `field`/`operator`/etc.
    kind for an index). `exchanges`, `countries`, `sectors`, `industries`
    have **no catalog kind at all** (`CatalogKind` has no such members) —
    the catalog genuinely cannot answer membership for those four
    dimensions today. Rather than rejecting every value (which would make
    the field unusable) or silently accepting it as verified (which would
    misrepresent what was checked), a non-empty selection in any of those
    four fields produces one advisory warning naming which dimensions
    could not be verified. This is the documented, deliberate reading of
    the ticket's catalog note.
  - `describeUniverseSizeWarning(resolution: { resolvable: boolean; count: number }): string | null`
    — turns a best-effort resolved count into AC7's warning: unresolvable
    → "size unknown"; resolvable and zero → "resolves to zero
    instruments"; resolvable and non-zero → no warning.
- `src/lib/webmcp/screener/createScreener.ts` — `create_screener` tool.
  - `export function createCreateScreenerTool(deps: WorkbenchDeps): ToolSpec`
- `src/lib/webmcp/screener/createScreener.test.ts`
- `src/lib/webmcp/screener/setScreenerUniverse.ts` — `set_screener_universe`
  tool.
  - `export function createSetScreenerUniverseTool(deps: WorkbenchDeps & { catalog?: CatalogRegistry; instrumentDirectory?: InstrumentDirectory }): ToolSpec`
    (`catalog` defaults to `builtinCatalogRegistry`; `instrumentDirectory`
    is optional per the ticket's guidance — its absence is itself an
    "unresolvable" signal, not a bug).
- `src/lib/webmcp/screener/setScreenerUniverse.test.ts`

Both tool modules keep a small private `toErrorResult`/`resolveWorkspaceId`
pair (copied in spirit from `src/lib/workbench/tools/index.ts`, not
imported) per the ticket's instruction not to modify or add to that file.

### Wiring into EPIC-1006

- Both tools call `recordCommit({ history, revisionService, clock }, { workspaceId, context, operationKind, requestInput, mutate })`
  from `src/lib/workbench/application/changeHistory.ts` — the same helper
  `restore_workspace_revision` and `undo_change` use — so every accepted
  change is both revisioned and appended to change history in one call.
- `create_screener`: `mutate(doc)` mints a screener via
  `createScreener(deps.ids, workspaceId, name)` (T-1009-1's factory,
  imported under a local alias to avoid shadowing the tool's own
  `create_screener` name), writes it into `doc` via `writeScreener`, and
  returns `{ document, affectedIds: [screener.screenerId], diffSummary, inverse: { document: doc, ... } }`.
  `doc` — the pre-mutation document `mutate` receives — is already the
  exact "screener didn't exist yet" state, so it is reused verbatim as the
  undo target instead of reconstructing it with `removeScreener`.
- `set_screener_universe`: catalog membership is checked **before**
  `recordCommit` is ever called, so an AC6 rejection never touches the
  repository, never advances a revision, and never consumes the
  `idempotency_key`. The size/emptiness resolution (AC7) is awaited before
  `recordCommit` too, since `RevisionService.commit`'s `mutate` is
  synchronous; its result is captured by the closure `mutate` reads from.
  Inside `mutate(doc)`: reads the current screener via `readScreener`,
  replaces `universe` wholesale with the normalized input, advances the
  **screener's own** `revision` by one (never the workspace revision —
  that is `RevisionService.commit`'s job per `recordSuccess`), writes it
  back via `writeScreener`, and returns
  `{ document, affectedIds: [screenerId], diffSummary, warnings: [...unverifiable, ...size], inverse: { document: doc, ... } }`.
  Again `doc` alone is the correct undo target: it already contains the
  screener at its prior universe and prior screener-local revision.

### Catalog and instrument-directory use

- `indexes` are checked against `builtinCatalogRegistry` (default) via
  `getCatalogItem`/`suggestCatalogIds`, mirroring
  `describeCatalogItem.ts`'s unknown-ID convention (name every unknown
  value, offer nearest-match suggestions).
- Universe-size resolution calls `instrumentDirectory.searchInstruments({ text: '', assetTypes, exchangeIds, countryCodes, limit: 1 })`
  when a directory is supplied. `text: ''` is deliberate: the port's
  `InstrumentQuery.text` is typed as `string`, not `NonEmptyString`, and
  this call only needs "does anything match these structural filters",
  not a text search — this is documented in a code comment at the call
  site. `sectors`/`industries`/`indexes`/`watchlists`/liquidity/exclusions
  are not expressible through `InstrumentDirectory` yet, so they do not
  further narrow the resolved count; this can only ever overcount, never
  hide a real emptiness, and is called out in the warning text and a
  comment. Whether the call "resolved" is judged generically —
  `!(data.length === 0 && warnings.length > 0)` — rather than by
  special-casing `unavailableDirectory.ts`'s source ID, so any future real
  adapter that legitimately returns zero-with-no-warning is read as
  "genuinely empty" and one that can't answer is read as "unknown," with
  no coupling to a specific infra module's identity.

### Test plan (`*.test.ts`, Vitest, alongside each module)

Deps built from real EPIC-1006 pieces exactly as
`src/lib/workbench/tools/index.test.ts` does:
`createLocalWorkspaceRepository(memoryStorage())`, `createIdSequencer()`,
`createIdempotencyCache()`, `createChangeHistory()`,
`createRevisionService(...)`, a fixed `Clock`. No new fake
`WorkspaceRepository` is needed since the real localStorage-backed one
already runs fully in memory against `memoryStorage()`.

`createScreener.test.ts`:
- creates a screener at revision 1 with an empty filter tree and default
  universe, bound to the workspace, and advances the workspace revision
  (AC1).
- an optional `name` is stored and echoed, and is not accepted in place of
  `screener_id` by a second call (AC2) — asserted by checking the returned
  screener's `screenerId` is a `screener_N` handle, never derived from
  `name`.
- a stale `expected_revision` is rejected as `revision_conflict`, nothing
  is created (AC8).
- a repeated `idempotency_key` replays the original `change_id`/screener
  ID rather than minting a second screener (AC8).
- the envelope carries `affected_ids` naming the screener and a
  present-tense `diff_summary` (AC9).
- `undo_token` reverses the creation (screener no longer readable via
  `readScreener`) (AC9).

`setScreenerUniverse.test.ts`:
- wholesale replacement: setting a second universe fully replaces the
  first (no merged leftovers), advances the screener's own revision, not
  just the workspace's (AC3).
- liquidity limits round-trip unchanged through the stored universe (AC4).
- exclusions are stored alongside an overlapping inclusion without being
  dropped or deduplicated away (AC5) — a sector both included and
  excluded is present in both arrays as given, per "exclusions always win"
  being an execution-time rule, not a storage-time one.
- an unknown `indexes` entry is rejected naming it (with a suggestion when
  a close catalog ID exists), and re-reading the screener afterwards shows
  the previous universe untouched (AC6).
- a non-empty `exchanges`/`countries`/`sectors`/`industries` selection is
  still applied and produces the "could not be verified" advisory warning
  (documents the catalog-gap decision above).
- with no `instrumentDirectory` supplied, and with one that reports
  unavailability (mirrors `createUnavailableInstrumentDirectory`'s
  shape), the response warns the size is unknown, never that it is zero.
- with a directory that resolves matches, an empty result set produces
  the AC7 "resolves to zero instruments" warning; a non-empty one produces
  no size warning.
- a stale `expected_revision` is rejected without mutating, reporting the
  current revision (AC8).
- a repeated `idempotency_key` replays the original envelope without a
  second universe change (AC8).
- `affected_ids`/`diff_summary`/`undo_token` present and undo restores the
  prior universe and prior screener revision (AC9).

`universeValidation.test.ts`:
- known vs. unknown index IDs, suggestion pass-through from
  `suggestCatalogIds`.
- the four-dimension unverifiable warning fires only when at least one of
  `exchanges`/`countries`/`sectors`/`industries` is non-empty, and names
  only the ones actually supplied.
- `describeUniverseSizeWarning` covers all three branches (unresolvable,
  resolvable-empty, resolvable-non-empty).
