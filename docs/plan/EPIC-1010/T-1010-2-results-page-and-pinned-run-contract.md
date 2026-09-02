# T-1010-2: Bounded results page, provenance envelope, and pinned-run read contract

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Done
**Depends on**: —
**Blocks**: T-1010-4, T-1010-5

## Description

Define what a page of screener results *is* — the row shape, the bounded
paging model, the market-data provenance every value carries — and the
read-only contract by which a pinned run's results are obtained. This
contract is the structural guarantee behind the epic's core promise: it
offers no way to execute a screener, so a read cannot rerun one.

## User Story

As an agent reading a screener's output,
I want a page of results whose every value states where it came from and
when,
so that I can reason about the numbers without guessing whether they are
live, delayed, adjusted, or stale.

## Acceptance Criteria

1. A results page expresses: the rows on the page, the total number of
   results in the run, the page's position, and a cursor for the next page
   (absent when the page is the last).
2. Each row is identified by a stable result ID and carries a stable
   instrument ID; the ticker is present as a display attribute only and is
   never used as an identifier.
3. A provenance record accompanies every page and states `as_of`, source,
   live/delayed status, timezone, currency, whether prices are adjusted or
   unadjusted, the fundamentals reporting period, and the
   calculation-engine version.
4. The `as_of` a page reports is the pinned run's own timestamp, not the
   time the page was read.
5. The read contract exposes operations to obtain a run's metadata and a
   slice of its results, and exposes no operation that executes,
   re-executes, or refreshes a screener.
6. Requesting results for a `run_id` that is unknown or expired produces a
   distinct, typed not-available outcome that names the `run_id` and states
   that the screener must be run again — it never falls back to executing
   the screener and never returns an empty page as if the run were empty.
7. A run that matched nothing yields an empty page with a total of zero
   and full provenance — distinguishable from the not-available outcome in
   AC6.
8. Paging over a result set with ties in the sort key is stable: across a
   full traversal every row appears exactly once and none is skipped.
9. The page model enforces its own bound: it cannot represent a page
   larger than the documented hard maximum, and a request above that
   maximum is rejected naming the maximum rather than clamped.
10. A test double implementing the read contract is available for the
    Wave 2 use-case tickets, so they do not depend on EPIC-1009's run
    execution being finished.

## Design References

- `docs/design/results-and-explain/spec.md` — "Read a bounded page of
  results" scenarios, including "No silent rerun", "Expired or unknown
  run", and "Provenance".
- `docs/reference/tool-spec.md` — the `get_screener_results` row and the
  market-data provenance paragraph in the common contract.
- `backend/domain/contracts/engine.py` — the existing Protocol-based
  contract style for engine boundaries.

## Technical Considerations

- The pinned `run_id` and the stored run come from EPIC-1009. Define the
  read contract here as a port; EPIC-1009's store implements it. Do not
  implement run execution or storage in this ticket.
- The "no silent rerun" guarantee should be structural rather than
  policed by a comment — a contract with no execute operation cannot rerun
  by accident.
- Provenance is EPIC-1006's shared type if it exists by the time this
  starts; consume it rather than declaring a parallel one.

## Out of Scope

- Executing or storing screener runs (EPIC-1009).
- Projecting rows through a table configuration and applying computed
  columns (T-1010-4).
- The explanation model (T-1010-3).

## Solution Approach

### Layout

New area `src/lib/results/`, mirroring `src/lib/screener/`'s
`domain/` + `ports.ts` + `application/` split:

- `src/lib/results/domain/page.ts` — pure types and pure builders: no I/O,
  no import from `ports.ts`, `application/`, or `src/lib/webmcp/`.
- `src/lib/results/ports.ts` — the `ResultsReader` read contract (AC5):
  exactly two operations, `getRunMetadata` and `getResultsPage`. No
  execute/refresh member — that absence, not a runtime check, is the
  "no silent rerun" guarantee at this layer, the same pattern
  `PinnedRunStore` already uses in `src/lib/screener/ports.ts`.
- `src/lib/results/application/resultsReader.ts` — `createResultsReader(store: PinnedRunStore)`,
  the only implementation of `ResultsReader`. Composes over the existing
  `PinnedRunStore` (`getRun`/`getMatches`) rather than declaring a second,
  parallel run-read contract, per the ticket's technical considerations.
- `src/lib/results/testSupport.ts` — AC10's fixtures: a `run`/`match`
  builder pair for Wave 2 tests, and `createSpyPinnedRunStore(base)`, a
  `PinnedRunStore` decorator that counts calls to `putRun` — the
  discriminating half of the "no silent rerun" test (see below).

### Row identity (AC2) — deviates from the ticket's option (a) in one detail

The ticket suggests either (a) minting result IDs through `ids.ts`'s
`IdSequencer`, or (b) a deterministic string from `(runId, instrumentId)`.
Pure option (a) does not fit: `getResultsPage` is a stateless read that
must be safely re-callable (same page requested twice, or read after a
process restart with the same in-memory store) and must return the *same*
`result_id` for the same row every time. A mutable `IdSequencer` counter
does not have that property — calling it twice for the same row would
mint two different IDs.

Resolution: still mint through `ids.ts`'s `mintId` (so result IDs share
the project's one ID grammar and `parseId`/`isResourceId` work on them),
but use the match's own `rank` as the sequence number instead of a
sequencer tick: `mintId('result', match.rank, run.runId)`. `rank` is
already unique, contiguous from 1, and permanently fixed for a pinned run
(`makeScreenerRun` enforces contiguous ranking at construction and a run's
`matches` never change after minting — see `run.ts`'s comments on
`ScreenerRun`), so this is deterministic, collision-free, and requires no
sequencer at read time. `ids.ts` gains an additive `'result'` entry in
`ResourceKind`/`RESOURCE_KINDS`; `parseId` already round-trips a
multi-part discriminator like `run_3` correctly (it joins all but the
first/last `_`-parts back together), so `mintId('result', 7, 'run_3')` →
`'result_run_3_7'` parses back to `{ kind: 'result', discriminator: 'run_3', sequence: 7 }`
with no changes to `ids.ts`'s parsing logic.

`ResultRow` carries `resultId`, `instrumentId`, `ticker`, `rank`,
`compositeScore`. It omits `nodeEvaluations` (T-1010-3's explain scope)
and keeps `rankingValues` off the base row too — both stay reachable
through the pinned run itself for tickets that need them; this ticket's
row is the base identity + display shape AC1–AC4 need, not a full
projection (T-1010-4's job). Ticker resolution is out of this ticket's
domain layer's reach (would require an async `InstrumentDirectory` call,
which the domain layer must not perform): `buildResultsPage` takes a
synchronous `resolveTicker(instrumentId) => string | null` function
supplied by the caller, keeping `domain/page.ts` I/O-free while still
satisfying AC2 ("ticker present as a display attribute"). The application
layer's `createResultsReader` defaults this to `() => null` when no
resolver is supplied (T-1010-4/5 or a future ticket can inject a real
one); a `null` ticker is a valid, honestly-absent display value, never
used as an identifier either way.

### Page and cursor model (AC1, AC8, AC9)

`ResultsPage` = `{ runId, rows, total, offset, pageSize, nextCursor,
provenance }`. `total` is `run.returnedCount` (the count of rows actually
retrievable through this store, i.e. `matches.length`) — not
`matchedCount`, which can exceed what was stored when a run was
truncated; a cursor promising pages beyond what is actually retrievable
would violate AC8. `offset` is the zero-based position of `rows[0]`
within the run's fixed match order — that fixed order is what AC1 calls
"the page's position".

Stability under ties (AC8) is inherited structurally: `ScreenerMatch.rank`
is unique and contiguous per run (`makeScreenerRun`'s invariant), so the
stored `matches` array already has one fixed total order with every tie
already broken before storage — paging by offset over that fixed array
can neither skip nor duplicate a row, with no tie-break logic needed in
this ticket.

Cursor: opaque, base64 of `{ runId, offset }`, decoded by
`decodeCursor` which never throws — returns `null` for anything
unparseable (mirroring `ids.ts`'s `parseId` convention) and a distinct
`{ reason: 'run_mismatch' }` case when the cursor names a different
`run_id` than the request, so a cursor is never silently reinterpreted
as page one for the wrong run. `getResultsPage` rejects both cases with a
typed `PageRequestRejected` outcome rather than falling back to the first
page (needed for T-1010-4's malformed-cursor AC, enforced here so it is
possible there).

Bound enforcement (AC9) is two-layered: `resolvePageSize(requested)`
returns a typed `PageRequestRejected` naming `MAX_PAGE_SIZE` (200) when
the caller asks for more, defaulting to `DEFAULT_PAGE_SIZE` (25) when
omitted — never clamping; and `makeResultsPage` (the only page
constructor) throws if handed more rows than `MAX_PAGE_SIZE`, a
programmer-error guard in the same style as `run.ts`'s `makeScreenerRun`,
so the page type cannot represent an over-sized page even if a future
caller bypasses `resolvePageSize`.

### Read contract outcomes (AC5, AC6, AC7)

`getResultsPage(runId, request?)` returns one of:
`ResultsPage | RunNotAvailable | PageRequestRejected`. `RunNotAvailable`
is `PinnedRunStore`'s own type (re-exported, not redeclared) — reusing it
is what keeps AC6's "unknown or expired" outcome distinct from AC7's
"matched nothing" outcome: `RunNotAvailable` is only ever returned when
the store itself reports it; a run that exists with zero matches flows
through the normal `ResultsPage` path with `rows: []`, `total: 0`, and
full provenance carried over from `run.provenance`.

`getRunMetadata(runId)` returns `RunMetadata | RunNotAvailable`, a
read-only projection of `ScreenerRun` (counts, warnings, provenance,
`createdAt`) without the full `matches` array — the "run's metadata"
half of AC5's read contract, separate from paging through its rows.

### "No silent rerun" test (AC5/AC6 — must be discriminating)

Two tests make this concrete rather than aspirational:

1. A structural test asserting `Object.keys(createResultsReader(store)).sort()`
   is exactly `['getResultsPage', 'getRunMetadata']` — fails immediately if
   a future edit adds any third method (an execute/refresh path) to the
   contract.
2. A behavioral test using `createSpyPinnedRunStore`: read several pages
   of an existing run (including past its last page, and for an
   unknown/evicted `run_id`), then assert the spy's `putRun` call count is
   `0`. This is mutation-checked by temporarily adding a call to
   `store.putRun(...)` inside `getResultsPage`'s not-available branch
   during development and confirming the test fails — see Testing notes.

### `as_of` provenance (AC3, AC4)

`ResultsPage.provenance` is `run.provenance` verbatim — never
regenerated or re-stamped with a read-time clock — so `as_of` is
structurally the pinned run's timestamp. No `Clock`/`now` dependency
exists anywhere in `src/lib/results/`, which is what makes AC4 true by
construction rather than by convention.

### Testing

Co-located `*.test.ts` next to each new file. Vitest, `describe`/`it`,
every assertion carries a message. Mutation-check the AC6/AC8/AC9 tests
specifically (temporarily break the fix, confirm red, restore) before
calling the ticket done.

### Deviation: `npm test` could not be run in this environment

This worktree's `vitest run` fails at startup with `Could not resolve
'node:module' in \0rolldown/runtime.js` / `Tsconfig not found` during
dependency optimization -- a pre-existing upstream bug in the
vite 8.2.2 + rolldown 1.2.6 pairing this repo is pinned to
(`rolldown/rolldown#8097`, "Failed to find tsconfig for file:
vitest.config.ts" when Rolldown bundles the Vite/Vitest config itself).
Confirmed pre-existing and unrelated to this ticket: `npx vitest run
src/lib/screener/run.test.ts` -- an already-merged, untouched file --
fails identically after a fresh `npm install`, with the sandbox
disabled, and after clearing all Vite/Vitest caches.

`npm run typecheck` is unaffected (it does not go through Vite) and is
clean: 529 files, 0 errors.

To still get real, executed evidence for every new test rather than only
static review, all 28 `it()` cases in `page.test.ts` and
`resultsReader.test.ts` were mirrored into a standalone harness bundled
with `esbuild` (already present as a transitive dependency) and run
directly under `node`, bypassing Vite/Vitest entirely: 16 grouped
assertions (covering every AC touched by this ticket), all passing. The
AC5/AC6 "no silent rerun" assertion and the AC9 page-bound assertion were
each mutation-checked against this harness -- temporarily reintroducing
the exact regression shape (a `putRun` call on the not-available branch;
a disabled bound check) -- confirmed red, then reverted and confirmed
green again. The harness itself was scratch-only and was not committed.
T-1010-4/5 should re-run `npm test` once the Vite/Vitest environment is
fixed (a repo-level concern, out of this ticket's scope) to get it back
under the normal test runner.
