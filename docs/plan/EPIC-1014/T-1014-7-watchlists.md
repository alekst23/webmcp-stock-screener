# T-1014-7: Watchlists

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Done
**Depends on**: — (consumes EPIC-1007's `watchlist` panel kind and
EPIC-1010's pinned runs)
**Blocks**: T-1014-11
**Issue**: —

## Description

Deliver `upsert_watchlist` and `save_results_to_watchlist` — the way a
result set stops being ephemeral. A watchlist is either static (a fixed
set of instruments) or dynamic (defined by a screener revision, so its
membership follows the screen). Saving a pinned run into one carries the
run's ID and timestamp along as provenance, so a researcher can later ask
where a name on the list came from.

Watchlists bind to EPIC-1007's `watchlist` panel kind, which is how the
researcher sees them.

## User Story

As a researcher who just found eleven names worth following,
I want them saved to a named watchlist along with a record of which run
produced them,
so that the work survives the tab, and so that in three weeks I can still
tell what screen these names came off.

## Acceptance Criteria

1. `upsert_watchlist` creates a static watchlist from a name and a set of
   instruments, with a stable ID.
2. `upsert_watchlist` creates a dynamic watchlist from a name and a
   screener revision; the watchlist is defined by the screener rather
   than a fixed member list and states which revision defines it.
3. `upsert_watchlist` called with an existing watchlist ID updates that
   watchlist in place — name, membership, or definition — and keeps its
   ID.
4. `save_results_to_watchlist` accepts a pinned run ID and a target
   watchlist, adds the run's instruments, and records the source run ID
   and the run's timestamp on the watchlist as provenance.
5. Saving results never re-executes the screener; the saved membership
   matches the pinned run exactly. Saving from an unknown or expired run
   ID is rejected saying so, rather than re-running to cover for it.
6. `save_results_to_watchlist` can save a selected subset of a run's
   results; only the selected instruments are added.
7. Membership is deduplicated by instrument ID, and the response reports
   how many of the incoming instruments were already present.
8. Saving into a dynamic watchlist is handled explicitly — either
   rejected explaining that its membership is screener-defined, or
   converting it with an explicit acknowledgement — never silently
   producing a watchlist whose membership contradicts its definition.
9. A watchlist can be bound to a `watchlist` panel and is visible to the
   researcher there, showing its name, membership, kind (static or
   dynamic), and provenance.
10. A watchlist's contents carry the market-data provenance envelope
    (`as_of`, source, live/delayed status, timezone, currency, price
    adjustment policy) wherever market values are shown.
11. Both tools accept `expected_revision` and `idempotency_key` and
    return the common mutation envelope; a repeated `idempotency_key`
    does not create a duplicate watchlist or add the instruments twice.
12. Undoing either mutation with the returned undo token restores the
    watchlist's prior state — including restoring a deleted membership
    or removing a newly created watchlist — exactly.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Maintain watchlists"
  scenario table.
- `docs/reference/tool-spec.md` — `upsert_watchlist` and
  `save_results_to_watchlist` ("create dynamic or static watchlists from
  results"); the `watchlist` panel kind in `create_panel`; watchlists as a
  universe input to `set_screener_universe`.
- `docs/plan/EPIC-1007/_epic.md` — the `watchlist` panel kind and how a
  panel binds to a resource.
- `docs/plan/EPIC-1010/_epic.md` — pinned `run_id` semantics, result
  selection, and the no-silent-rerun guarantee.
- `docs/plan/EPIC-1009/_epic.md` — `set_screener_universe`, which
  accepts watchlists as a universe input.
- `docs/plan/EPIC-1006/_epic.md` — mutation envelope, revisions, undo.

## Technical Considerations

- Persistence scope is a working assumption recorded in the epic's Open
  Questions: per-browser, behind a port, so a server-backed store can
  replace it without changing the tool surface.
- Static and dynamic watchlists differ enough in behavior that conflating
  them will cause exactly the silent-contradiction bug AC8 guards
  against. Keep the kinds explicit in the model.
- A dynamic watchlist references a screener revision; deleting or
  superseding that screener needs defined behavior rather than a dangling
  reference.
- Watchlists feed screener universes. A cycle — a screener whose universe
  is a watchlist defined by that same screener — needs to be detected and
  rejected.

## Out of Scope

- The `watchlist` panel kind and its rendering (EPIC-1007).
- Alerts on watchlist membership changes (T-1014-8, T-1014-9).
- Sharing or syncing watchlists across browsers, devices, or users.
- Importing a watchlist from an external file or broker.

## Solution Approach

Follows the same pattern as EPIC-1011/1012's sibling tickets
(`workbench/chart/`, `workbench/similarity/`): a domain model stored inside
`WorkspaceDocument.extensions`, mutated only through EPIC-1006's
`OperationRegistry`/`RevisionService`, so revision guarding, idempotency
replay, the mutation envelope and undo all come for free rather than being
reimplemented here. New files only, under `src/lib/workbench/watchlist/`;
`--skip-design-gate` authorized per the dispatch brief (no existing
`## Solution Approach`/test stubs, epic behavioral spec + detailed ACs
stand in for them). Tools are built with a `WATCHLIST_TOOLS_ENABLED = false`
composition root (`tools/registerWatchlistTools.ts`), mirroring
`registerChartTools.ts`/`registerSimilarityTools.ts` — not wired into the
live `/workbench` route by this ticket; T-1014-11 does that wiring.

### Domain (`domain/watchlist.ts`)

- `WatchlistKind = 'static' | 'dynamic'`. A `StaticWatchlist` carries
  `members: WatchlistMember[]`; a `DynamicWatchlist` carries `screenerId` +
  `screenerRevision` and **no** membership field at all — resolving a
  dynamic watchlist's actual members is a read concern for the (out-of-scope)
  panel renderer, never something this ticket computes or stores, which is
  what keeps AC8's static/dynamic distinction structurally impossible to
  contradict (a dynamic watchlist has no membership array to contradict).
- `WatchlistMember { instrumentId, addedAt, source }` where `source` is
  `{ kind: 'manual' }` or `{ kind: 'run', runId, runCreatedAt, provenance }`.
  Provenance lives *per member* rather than as one watchlist-level "last
  save" field: a watchlist can accumulate members from several saved runs
  over its life, and the user story ("in three weeks, tell what screen these
  names came off") is a per-name question. This is also what satisfies AC10
  for watchlist contents: each member that came from a run carries that
  run's full `MarketDataProvenance` envelope right on it.
- Stored under `doc.extensions.watchlists`, keyed by `watchlistId`, with the
  same normalize-on-read/never-throw discipline as
  `chart/domain/capturedSetup.ts` and `screener/state.ts`: `readWatchlist`,
  `readWatchlists`, `writeWatchlist`, `removeWatchlist`, `watchlistIdSeed`,
  `normalizeWatchlist`, `toWireWatchlist`.
- `addMembers(watchlist, incoming)`: dedupes `incoming` by `instrumentId`
  first (so a duplicate within one call's own selection can't be
  double-counted), then dedupes against existing membership — an instrument
  already present keeps its original member record (earlier
  source/provenance is the truer answer to "where did this come from") and
  is only counted. Returns `{ watchlist, addedCount, alreadyPresentCount }`
  with `addedCount + alreadyPresentCount` always equal to the de-duplicated
  incoming count (AC7).

### Cycle detection (`domain/cycles.ts`)

`screenerReachesWatchlist(doc, screenerId, targetWatchlistId)` walks
`ScreenerDefinition.universe.watchlists` (already a field on
`UniverseSpec` per EPIC-1009) and, for every dynamic watchlist found there,
recurses into *its* `screenerId` — a `visited` set stops the walk from
looping forever if a cycle already exists elsewhere in the graph. Called
only when `upsert_watchlist` would make an *existing* watchlist ID dynamic
against a given screener: a brand-new watchlist ID is never yet referenced
by any screener's universe (IDs are minted, never caller-chosen), so a cycle
is structurally impossible on creation and the check is skipped there.

### `upsert_watchlist` (`application/upsertWatchlist.ts`, operation kind
`watchlist.upsert`)

Replace semantics, not patch, for the fields that define a watchlist's
*kind* — but `name` is left untouched when omitted, so a membership-only or
screener-only update never blanks it. `kind` is required on every call
(create or update) for explicitness. Static: `instrumentIds`, when given,
becomes the whole new membership (existing members whose ID persists keep
their original `addedAt`/`source`; omitted means "leave membership as is").
Dynamic: `screenerId` required, `screenerRevision` optional (defaults to the
screener's current revision). Converting an existing dynamic watchlist to
static without supplying `instrumentIds` is rejected (there is no prior
membership to fall back to). Cycle check runs when the resulting kind is
dynamic and the watchlist ID already existed. `apply()`'s inverse is simply
the pre-mutation document, matching `chartAnnotations.ts`'s and
`captureSetup.ts`'s own inverse pattern — undo restores prior name,
membership/definition, and removes a newly-minted watchlist entirely.

### `save_results_to_watchlist` (`application/saveResultsToWatchlist.ts`,
operation kind `watchlist.save_results`)

Takes a `PinnedRunStore` (EPIC-1010, `screener/ports.ts`) as an injected
dependency and calls only `getRun` — `PinnedRunStore` has no
execute/refresh member at all, so "never re-executes the screener" (AC5) is
structural, the same guarantee `screener/runStore.ts`'s own header comment
describes for EPIC-1010. `getRun` returning `RunNotAvailable` (unknown or
evicted) is a validation issue, not a re-run. `instrumentIds` (optional)
selects a subset of `run.matches`; every given ID must appear in the run's
matches or validation rejects it by name (AC6). Saving into a dynamic
watchlist without `convertDynamic: true` is a validation issue naming the
screener that defines it (AC8); with it, `apply()` converts the target to a
static watchlist (empty starting membership) before adding, and the
envelope carries a warning stating the conversion happened. Each added
member's `source` is `{ kind: 'run', runId, runCreatedAt: run.createdAt,
provenance: run.provenance }`.

`added_count`/`already_present_count` in the tool's JSON response are
computed by the **tool function**, not read back off post-commit state: it
snapshots the target watchlist's membership immediately before calling
`applyOperations` for this call and diffs against that. This makes the
numbers accurate for what genuinely happened on *this* call — including an
idempotent replay, which truthfully reports 0 added (nothing happened a
second time) rather than incorrectly repeating the first call's numbers.
AC11's actual guarantee (repeating an `idempotency_key` never creates a
duplicate watchlist or adds instruments twice) comes from
`RevisionService`'s existing idempotency cache, unchanged.

### Tools (`tools/upsertWatchlist.ts`, `tools/saveResultsToWatchlist.ts`)

Mirror `chart/tools/addChartAnnotation.ts` exactly: translate snake_case
wire input to the operation's input, call `applyOperations` with
`expected_revision`/`idempotency_key` mapped into `MutationContext`, map
typed domain errors to `ToolResult` failures via `toWireError()`, and return
`{ ...toWireEnvelope(envelope), watchlist: toWireWatchlist(...), ... }` on
success. `tools/index.ts` assembles both plus registers the two operations
(`registerWatchlistOperations`); `tools/registerWatchlistTools.ts` is the
gated composition root.

### Testing

- `domain/watchlist.test.ts`: normalize/round-trip for both kinds, wire
  serialization, `addMembers` de-dup accounting.
- `domain/cycles.test.ts`: direct cycle (screener's universe includes the
  watchlist defined by that same screener) and a 2-hop transitive cycle
  through a second screener/watchlist pair; a non-cyclic reference is not
  rejected.
- `application/upsertWatchlist.test.ts` and `saveResultsToWatchlist.test.ts`:
  create/update static and dynamic, rename-only update preserving
  membership, revision guard, idempotency replay (no duplicate/no
  double-add — mutation check: temporarily bypass the idempotency cache
  lookup and confirm the test fails), undo via `undoChange` restoring prior
  state (including removing a newly-created watchlist and restoring a
  removed member), no-silent-rerun (assert via a spy `PinnedRunStore`,
  mirroring `results/testSupport.ts`'s `createSpyPinnedRunStore`, that
  `getRun` is called and nothing resembling an execute path exists to call),
  unknown/evicted run rejection, subset selection, duplicate-instrument
  dedup and count reporting, dynamic-watchlist rejection and explicit
  conversion.
- `tools/*.test.ts`: end-to-end tool behavior over the wire shape, following
  `addChartAnnotation.test.ts`'s structure.
