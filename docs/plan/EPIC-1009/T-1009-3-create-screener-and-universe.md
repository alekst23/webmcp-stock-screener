# T-1009-3: `create_screener` and `set_screener_universe` tools

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
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
