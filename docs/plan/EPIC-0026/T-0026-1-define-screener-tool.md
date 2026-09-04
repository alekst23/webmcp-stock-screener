# T-0026-1: `define_screener` tool

**Epic**: EPIC-0026 (Agent Screener Loop)
**Design**: docs/design/screener-core/
**Status**: Not started
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
