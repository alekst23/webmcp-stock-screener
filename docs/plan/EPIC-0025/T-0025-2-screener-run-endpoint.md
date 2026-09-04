# T-0025-2: `POST /screener/run` endpoint

**Epic**: EPIC-0025 (Server-Side Screener Evaluation Endpoint)
**Design**: docs/design/screener-core/
**Status**: Not started
**Depends on**: T-0025-1
**Blocks**: —
**Resolves**: #25

## Description

Wires T-0025-1's resolvers and the existing filter-tree evaluator
(`backend/domain/filter_evaluation.py`) into one stateless endpoint: a
screener definition in, a bounded ranked result set out. `dry_run: true`
validates the same definition through the same pipeline without
executing it, so validation and execution can never disagree about what
passes.

This is the contract EPIC-0026's `HttpScreenerEvaluationPort` targets —
`{universe, conditions, ranking, limit}` in, and a response shaped to
become a frontend `ScreenerRun` without transformation.

## User Story

As the frontend `ScreenerEvaluationPort`,
I want one endpoint that validates or executes a screener definition
against real data,
so that `run_screener` and `validate` (via `define_screener`) get a real
answer instead of an empty-universe refusal.

## Acceptance Criteria

1. `POST /screener/run` with `{universe, conditions, ranking, limit}`
   narrows the universe (T-0025-1), resolves every field the conditions
   and ranking reference, evaluates the filter tree, ranks, and truncates
   to `limit`.
2. `dry_run: true` runs the same universe-narrowing and field-resolution
   steps and reports every independent validation problem together
   (invalid parameters, unresolvable fields, contradictory filters, a
   universe that resolves to zero instruments) without executing.
3. A universe that resolves to zero instruments is a refusal naming the
   reason, never an empty success.
4. The response carries, per matched instrument: a full instrument
   reference (id, symbol, exchange, asset type — not a bare ticker),
   every ranking field's value, and per-filter-node pass/fail state.
5. The response carries run-level provenance: `as_of`, live/delayed
   status, universe/matched/returned counts, and whether results were
   truncated by `limit`.
6. The endpoint is stateless — it does not persist the run; the caller
   (browser) owns pinning and retention.
7. Every problem `dry_run` or a real evaluation reports is independently
   reproducible from the request (no reliance on prior calls) — the
   endpoint has no session state to get out of sync.

## Out of Scope

- Server-side run storage or a `GET` by run id — the browser pins runs
  in-memory (`PinnedRunStore`), unchanged by this ticket.
- Anything on the frontend — EPIC-0026 wires the caller.
