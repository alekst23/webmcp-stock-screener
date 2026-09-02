# EPIC-1006: Workspace, Revisions & the Common Tool Contract

**Depends on**: —
**Blocks**: EPIC-1007 … EPIC-1014 (every epic in the new tool-surface program)
**Issue**: —
**Design**: docs/design/workspace-revisions/

## Description

`docs/reference/tool-spec.md` specifies a ~33-tool WebMCP surface for a stock
screener / research workbench, and states one contract every tool in it must
obey: stable IDs for every resource, `expected_revision` and
`idempotency_key` on every mutation, a fixed mutation-result envelope, and
explicit provenance on every market-data result. This epic builds that
contract as reusable infrastructure, plus the seven workspace and
persistence tools that exercise it end to end.

It is the foundation of the program: nine sibling epics import the types,
helpers and registry defined here rather than reinventing them. It is built
in **new files alongside** the shipping 11-tool pattern-research surface
(`src/lib/webmcp/tools.ts`, `src/lib/workspace/store.ts`), which this epic
does not modify. EPIC-1015 retires the old surface at the end of the
program; `main` stays deployable throughout.

## User Story

As an AI agent driving the research workbench on a user's behalf,
I want every resource addressed by a stable ID and every mutation to report
its revision, its diff, its warnings and an undo token,
so that I can change the workspace safely, detect when the human changed it
underneath me, retry without duplicating work, and reverse a mistake.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1006-1 | Workspace document model and stable-ID scheme | — | Done |
| 2 | T-1006-2 | Mutation envelope contract and builder | — | Done |
| 3 | T-1006-3 | Market-data provenance contract | — | Done |
| 4 | T-1006-4 | Workspace repository and named revision storage | T-1006-1 | Done |
| 5 | T-1006-5 | Optimistic concurrency and idempotency replay | T-1006-1, T-1006-2, T-1006-4 | Done |
| 6 | T-1006-6 | Change history, undo tokens and revision restore | T-1006-5 | Done |
| 7 | T-1006-7 | Extensible operation registry with preview and apply | T-1006-5 | Done |
| 8 | T-1006-8 | Workspace and context tool surface | T-1006-3, T-1006-6, T-1006-7 | Done |
| 9 | T-1006-9 | Wire-case the three read-only tools | T-1006-8 | Open |
| 10 | T-1006-10 | Type `OperationRegistry.register`'s errors | T-1006-7 | Open |
| 11 | T-1006-11 | Boundary logging, cross-tab write race, and re-serialization cost | T-1006-4, T-1006-5 | Open |

## Dependency Graph

```
T-1006-1 ──┬──> T-1006-4 ──> T-1006-5 ──┬──> T-1006-6 ──┐
           │                            │               │
T-1006-2 ──┘                            └──> T-1006-7 ──┼──> T-1006-8
                                                        │
T-1006-3 ───────────────────────────────────────────────┘
```

## Wave Plan

- **Wave 1** (parallel): T-1006-1, T-1006-2, T-1006-3 — independent contract
  definitions with no dependencies.
- **Wave 2**: T-1006-4 — needs the workspace document and ID scheme.
- **Wave 3**: T-1006-5 — needs the repository plus the envelope shape.
- **Wave 4** (parallel): T-1006-6, T-1006-7 — both build on the revision
  service; neither depends on the other.
- **Wave 5**: T-1006-8 — wires the seven tools onto everything above.

## Acceptance Criteria

1. Every resource the new surface exposes is addressed by a stable,
   prefixed, human-legible ID that survives reordering, and never by
   positional index or bare ticker.
2. Every mutation performed through the new infrastructure returns an
   envelope carrying a change ID, the new revision, the affected IDs, a
   human-readable diff summary, a warnings list and an undo token.
3. A mutation supplying an `expected_revision` that does not match the
   workspace's current revision is rejected without any state change, and
   the rejection reports the actual current revision.
4. Repeating a mutation with an `idempotency_key` already seen returns the
   original envelope unchanged and applies no second change.
5. An undo token returned by a mutation reverses exactly that mutation and
   cannot be redeemed twice.
6. The change history lists past changes for a workspace with their IDs,
   revisions, timestamps, originating actor and diff summaries.
7. A previously saved revision can be restored, and restoring is itself a
   recorded, undoable change rather than a rewrite of history.
8. Any market-data-bearing result can carry a provenance record stating
   as-of time, source, live/delayed status, timezone, currency,
   price-adjustment basis, fundamentals reporting period and
   calculation-engine version.
9. A new typed operation can be registered by code outside this epic's
   modules and become previewable and applicable without editing the
   registry's own source.
10. Multiple operations applied together either all commit as one revision
    or none do.
11. `get_app_context`, `get_canvas_state`, `create_workspace`,
    `save_workspace`, `undo_change`, `get_change_history` and
    `restore_workspace_revision` are callable through the WebMCP surface
    and obey criteria 1-7.
12. The shipping 11-tool pattern-research surface and its UI continue to
    work unchanged, and the app remains deployable.

## Design References

- `docs/reference/tool-spec.md` — the program's source of truth; its
  "Common contract for every tool" section defines this epic's envelope,
  stable-ID rule and market-data provenance requirements, and the
  Context / Workspace / Persistence rows define its seven tools.
- `docs/design/workspace-revisions/spec.md` — behavioral spec for this epic.
- `docs/design/workspace-revisions/technical.md` — the exported contract
  surface sibling epics import.
- `src/lib/webmcp/types.ts` — the existing `ToolSpec` / `ToolResult`
  registration contract the new tools must satisfy.
- `src/lib/webmcp/register.ts` — how tools reach `document.modelContext`.
- `src/lib/workspace/store.ts` — the existing explicit-`Storage`-parameter
  persistence pattern the new repository follows.
- `src/lib/workspace/snapshots.ts` — the existing separate-storage-key
  pattern for adding a store without disturbing the live one.

## Open Questions

Recorded per the program rule that unanswered spec points become explicit
questions with a stated working assumption, not a blocking interview.

1. **Wire casing.** The spec's envelope is snake_case JSON; the project's
   TypeScript convention is camelCase. *Assumption*: internal types are
   camelCase, and one serializer emits the snake_case agent-facing wire
   shape. Tool input fields stay snake_case (`expected_revision`,
   `idempotency_key`) because they are the contract the spec names.
2. **Where revisions live.** The spec does not name a persistence backend.
   *Assumption*: `localStorage`, per-browser, matching the project's
   existing no-backend model, behind a port so a server store can replace
   it later.
3. **Undoing something other than the newest change.** The spec says only
   "reverse a mutation using its returned undo token". *Assumption*: undo
   tokens are single-use and redeemable only while their change is the
   newest un-undone change; otherwise the call fails with a conflict that
   points at `restore_workspace_revision`.
4. **Whether `expected_revision` is mandatory.** *Assumption*: optional.
   Omitting it applies the change but adds a warning to the envelope, so
   careless agents are visible rather than blocked.
5. **Named saves vs. the mutation counter.** *Assumption*: one monotonic
   per-workspace counter. `save_workspace` labels the current revision with
   a name; it does not open a second numbering scheme.
6. **History and idempotency retention.** The spec is silent. *Assumption*:
   both are bounded, with the limits stated in `technical.md`, and the
   oldest entries are pruned rather than the store being allowed to grow
   without limit.
7. **What "permissions" means in `get_app_context`.** *Assumption*: a static
   capability descriptor (what the surface can and cannot do, including
   that trading is not available) until a real permission model exists.

## Out of Scope

- Any screener, chart, results, similarity, catalog, discovery, alert or
  export tool — those belong to sibling epics, which register their
  operations against this epic's registry.
- `preview_workspace_changes` and `apply_previewed_changes` as tools —
  EPIC-1013 owns them; this epic delivers only the registry and the
  preview/apply engine they call.
- Building a market-data pipeline. Reference and fundamental data is a
  separate parallel workstream; this epic defines the provenance contract
  and the port, not a provider.
- Modifying, refactoring or deleting the existing 11 tools,
  `src/lib/workspace/store.ts` or the current UI — EPIC-1015's job.
- Server-side or cross-device persistence, and multi-user concurrency.
  Revisions are per-browser, matching the project's existing model.
- Trading, ordering, or any permissioned write beyond the workspace.
