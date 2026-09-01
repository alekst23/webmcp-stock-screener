# T-1012-4: `find_similar_setups` tool

**Epic**: EPIC-1012 (Similarity Search)
**Design**: docs/design/similarity-search/
**Status**: Open
**Depends on**: T-1012-3
**Blocks**: T-1012-8

## Description

The agent-facing entry point to the epic. Given a captured setup the
researcher liked, `find_similar_setups` searches other symbols and other
historical windows for setups that resemble it, and binds the ranked
result into the workspace so both the human and the agent can see the same
candidates.

Because it pins a run and can bind a panel, it is a mutation and follows
the common tool contract — `expected_revision`, `idempotency_key`, and the
standard mutation envelope with an undo token.

## User Story

As a researcher working alongside an agent,
I want to ask "find setups like this one" and get a ranked, visible list of
candidates,
so that I can move from one interesting chart to a set of comparable cases
without hand-searching the universe.

## Acceptance Criteria

1. The tool accepts a captured setup by its stable ID (as produced by
   `capture_chart_setup`), a search scope, and optional feature weights,
   result limit, and minimum score.
2. It returns a stable similarity run ID together with the ranked
   candidates, each identified by a stable candidate ID and carrying its
   overall score and per-family measured similarities.
3. No candidate is ever returned as a bare score with no feature
   breakdown, and no candidate is identified by ticker alone.
4. The response states the weight set applied, the normalization settings
   applied, the search scope applied, and the full market-data provenance —
   `as_of`, source, live/delayed status, timezone, currency,
   adjusted/unadjusted price basis, and calculation-engine version.
5. As a mutation, the tool honors `expected_revision` and
   `idempotency_key` and returns the common mutation envelope:
   `change_id`, `new_revision`, `affected_ids`, `diff_summary`, `warnings`,
   and `undo_token`.
6. Calling the tool twice with the same `idempotency_key` produces one
   change, not two, and the second call reports the first call's result.
7. Calling with a stale `expected_revision` is rejected with a conflict the
   caller can act on, and the workspace is left unchanged.
8. Applying the returned `undo_token` reverses the workspace change the
   call made.
9. When no candidate clears the minimum score, the tool returns an empty
   ranked list with a warning stating why — it never relaxes the threshold
   or substitutes weaker matches silently.
10. Referencing a setup ID that does not exist returns an actionable error
    naming the missing setup, not an empty result set.
11. Weights supplied by the caller are echoed in the response, so a later
    refinement pass can read the weights a run used and supply an adjusted
    set back without any contract change.
12. The tool is registered on the new tool surface only; the existing
    11-tool surface and its registration are unchanged.

## Design References

- `docs/reference/tool-spec.md` — the `find_similar_setups` row, the common
  mutation contract, and the market-data provenance rule
- `docs/plan/EPIC-1012/T-1012-3-similarity-api.md` — the HTTP contract
  this tool calls
- `src/lib/webmcp/register.ts`, `src/lib/webmcp/tools.ts` — the existing
  tool-registration and input-validation style to follow in the new files
- `src/lib/workspace/apiEngine.ts` — the existing browser-to-backend client
  style, including error surfacing

## Technical Considerations

- The captured-setup type is EPIC-1011's contract and the mutation
  envelope, `expected_revision`, `idempotency_key`, undo tokens, and stable
  IDs are EPIC-1006's. Consume both; define neither.
- AC6 and AC8 are the two most easily faked criteria in this ticket. A test
  for either is only evidence if it fails when the corresponding behavior
  is removed.
- New files only — a new tool module and its registration, alongside the
  existing surface, not replacing it.

## Out of Scope

- The explanation tool (T-1012-5) and comparison tool (T-1012-7).
- Rendering candidates (T-1012-6).
- Adjusting weights from accepted/rejected matches (EPIC-1014).
