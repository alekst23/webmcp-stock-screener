# T-0026-1: `define_screener` tool

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/screener-core/
**Status**: Done
**Depends on**: —
**Blocks**: T-0026-3

## Description

One tool, one payload — `universe`, `conditions` (filter tree), `ranking`,
`limit` — that creates or fully replaces a screener's definition, and
validates everything together before committing anything. Absorbs the
domain logic of `create_screener`, `set_screener_universe`,
`edit_filter_tree`, `set_screener_ranking`, and `validate_screener`
(their filter-tree validation, ranking normalization, and universe
resolution are reused; their five-tool boundary is not).

Targets the workspace's current screener by default via
`WorkspaceDocument.screenerId` (see epic notes) — the common case never
requires the caller to track or pass an id.

## User Story

As an agent,
I want to define a complete screener — or change any part of an existing
one — in a single call that validates everything together,
so that "make it top 20" or "only ones above $10" is one call with the
full payload, not a patch to one of five other calls.

## Acceptance Criteria

1. Called with no `screener_id` and no current screener on the workspace:
   creates a new screener at revision 1 from the given
   universe/conditions/ranking/limit, and sets it as the workspace's
   current screener (`WorkspaceDocument.screenerId`).
2. Called with no `screener_id` and a current screener already set:
   replaces that screener's entire definition as a new revision
   (full-replace, not a patch — omitted fields reset to empty/default,
   they are not carried over from the prior revision).
3. Called with an explicit `screener_id` that doesn't match any screener
   in the workspace: rejected, naming the unrecognized id; no screener is
   created or changed.
4. Every problem in the payload — unknown catalog id (field, operator,
   study, pattern, interval), a parameter outside its declared range, or
   a universe that resolves to zero instruments — is collected and
   returned together in one response, not just the first one found.
5. When a time-based request is necessarily approximated by the data
   available (e.g. an hours-based lookback against a daily-bars-only
   pipeline), the response states the actual granularity used.
6. An instrument whose relevant history is shorter than a condition's
   lookback resolves that condition as not-evaluable and fails closed
   (per the existing per-condition fold), rather than erroring the whole
   definition.
7. The response returns the screener id, revision, and either success or
   the complete list of problems — never a partial commit.

## Out of Scope

- Executing the screener (`run_screener`, already built, T-0026-3 wires
  its evaluation port).
- A second, concurrent screener in the same workspace — structurally
  possible (screeners are already stored in a map keyed by id) but no
  tool surfaces a way to list or pick between them.

## Solution Approach

`define_screener` is a new, standalone tool
(`src/lib/webmcp/screener/defineScreener.ts`), not yet wired into
`buildScreenerTools`/the live composition root — that wiring is
T-0026-3's job, per the ticket brief.

**Two build passes over one wire payload.** `RevisionService.commit`'s
`mutate(doc)` callback is synchronous, but the payload's full validation
needs the (async) market-data port
(`screenerValidation.ts#validateScreenerDefinition`). So the tool:

1. Runs an async *pre-check* against the initially-read document: builds
   the whole candidate definition (universe, filter tree, ranking) using
   disposable placeholder node ids (never touching `deps.ids`), then hands
   it to the reused `validateScreenerDefinition` for catalog/availability/
   contradiction/cost/empty-universe checks. If anything blocking comes
   back, the call fails here — nothing is minted, nothing is written
   (AC7).
2. Only if that pre-check is clean does it call `recordCommit`. Its
   `mutate(freshDoc)` callback re-resolves the target against the
   *freshest* document (in case another change landed during the async
   pre-check — matches every sibling screener tool's own mutate()
   convention) and re-runs the identical, purely-synchronous build step
   with real ids from `deps.ids`. Re-validation isn't needed on this pass:
   the builders are deterministic given the same wire input and registry,
   so a clean pre-check guarantees a clean commit.

This is what makes AC7's "never a partial commit" hold despite validation
needing an async port that `mutate()` can't call.

**New domain modules (reused by the tool, not tool-specific):**

- `src/lib/screener/screenerDefinitionBuilder.ts` — `buildFilterTree`:
  turns the caller's whole `conditions` payload (a group, a bare
  condition, or an array of nodes) into a rooted `FilterNode` tree in one
  pass, collecting every structural problem (raw-code fields, unparseable
  condition types, `"not"` arity) instead of stopping at the first (AC4).
  Catalog/range checks are deliberately *not* done here —
  `validateScreenerDefinition`'s existing walk already does that, so this
  module hands it a structurally-valid tree rather than duplicating that
  walk.
- `src/lib/screener/granularityApproximation.ts` — `approximateGranularity`
  (AC5): when a `temporal`/`pattern` condition names an interval the
  catalog marks `unavailable`, and the catalog has exactly one other
  interval marked `available` (today, `interval.1d`), the condition's
  `intervalId` is substituted for it and the substitution is reported
  (surfaced as a `warnings` entry). Zero or several available intervals
  means "don't guess" — the condition is left as given for the existing
  unavailable-data check to reject as it always has.
- `src/lib/webmcp/screener/defineScreenerRanking.ts` — `buildRankingSpec`:
  wire ranking + the top-level `limit` convenience field → `RankingSpec |
  null`, reusing `screener/ranking.ts#validateRankingDeclaration` for
  shape/weight validation and mirroring `set_screener_ranking.ts`'s own
  catalog-field check. A limit given with no ranking fields still builds a
  `RankingSpec` (fields: `[]`, the given limit) rather than being silently
  dropped the way `set_screener_ranking`'s fields-only "clear" convention
  would — this is what makes a bare "make it top 20" call work.
- `src/lib/webmcp/screener/defineScreenerUniverse.ts` — wire→domain
  universe mapping (mirrors `set_screener_universe.ts`) plus
  `checkUniverseCatalogMembership` reuse for unrecognized index ids
  (AC4) — the one universe check `validateScreenerDefinition` doesn't
  itself do, since it only resolves universe *size*, never index
  membership.
- `src/lib/webmcp/screener/defineScreenerSchema.ts` — the tool's
  description and JSON input schema, split out to keep
  `defineScreener.ts` under the project's file-size guidance.

**AC6 (fail-closed per-condition lookback)** required no new code: it
describes the existing execution-time behavior
(`screener/engine/conditionEvaluation.ts`'s `dataUnavailable` /
`tree.ts`'s per-node fold), which `define_screener` never touches
(execution stays out of scope until T-0026-3). A test confirms
`define_screener` itself doesn't add any bogus definition-time check that
would reject a large lookback — that's correctly left to the (unbuilt)
per-instrument evaluation, not this tool.

**Target resolution** (`resolveTarget`) implements AC1–AC3 exactly per
technical.md's table: an explicit `screener_id` always addresses that
screener (rejected if unknown, AC3) and never repoints
`WorkspaceDocument.screenerId`; an absent `screener_id` targets the
current screener if one is set (AC2, full-replace) or mints a new one and
sets the pointer (AC1) otherwise.

**Wire error convention note**: `fail(message, extra)` builds
`{error: message, ...extra}` — if `extra` also sets `error` (a machine
code), it silently clobbers the human message. `set_screener_ranking.ts`
already documents this; `define_screener`'s "unknown screener_id"
rejection avoids the trap by not setting a competing `error` code, and its
validation-failure response explicitly duplicates the message under a
`message` key.

### Tests

- `src/lib/screener/screenerDefinitionBuilder.test.ts` (11 tests) — tree
  shapes, raw-code rejection, `"not"` arity, unknown condition type,
  multi-problem collection.
- `src/lib/screener/granularityApproximation.test.ts` (7 tests) —
  substitution, no-op on already-available/unknown/ambiguous intervals,
  recursion into nested groups, non-interval conditions untouched.
- `src/lib/webmcp/screener/defineScreenerRanking.test.ts` (6 tests) —
  clear/limit-alone/fields/tie-break/unknown-field/non-numeric-field
  cases.
- `src/lib/webmcp/screener/defineScreener.test.ts` (18 tests) — one test
  per acceptance criterion (AC1–AC7) plus full-replace reset semantics,
  pointer-not-repointed on explicit `screener_id`, undo, idempotency
  replay, `expected_revision` conflict, raw-code rejection, name
  echo, and a genuinely empty-resolving universe via a fake
  `ScreenerMarketData`.

Total: 42 new tests, all passing. Full suite (`npm run test`): 3043
passed. `npm run typecheck`: 0 errors. `npx prettier --check` on every
touched file: clean.

### Deviations / open questions for review

- The ticket's payload description lists `universe`, `conditions`,
  `ranking`, `limit` as four items; `limit` is implemented as a top-level
  wire field that sets `RankingSpec.limit` (rather than requiring it
  nested under `ranking`), since "make it top 20" should work without the
  caller also specifying ranking fields. Worth confirming this matches
  intent versus nesting `limit` under `ranking` only.
- `engine/ranking.ts#applyRanking`'s existing `defaultOrder` branch
  (`ranking === null || ranking.fields.length === 0`) ignores
  `RankingSpec.limit` when `fields` is empty — so a `limit`-only,
  no-ranking-fields definition stores the caller's limit correctly, but
  today's execution engine would not yet honor it once T-0026-3 wires
  execution. Flagging for whoever picks up execution wiring; out of this
  ticket's scope (browser-side definition only).
- This agent was sandboxed into a worktree separate from the one
  provisioned for this ticket
  (`.worktrees/worktree-agent-T-0026-1-EPIC-0026-run1` on branch
  `worktree-agent-T-0026-1-EPIC-0026-run1`); the harness refused to `cd`
  into it from this agent's own isolated worktree. Work was done instead
  on this agent's own worktree/branch (`worktree-agent-a2a6339f575e3ad70`),
  fast-forwarded onto the epic branch's tip first. The orchestrator will
  need to merge from that branch instead of the originally-named one.
