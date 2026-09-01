# EPIC-1013: Safety layer (preview & apply)

**Depends on**: EPIC-1006 (workspace revisions + common mutation contract +
extensible operation registry) — hard prerequisite
**Blocks**: —
**Design**: docs/design/safety-preview-apply/

## Description

An agent driving the workbench can propose a batch of changes that
reshapes a researcher's entire workspace in one turn. This epic adds the
safety gate that makes that acceptable: `preview_workspace_changes`
validates a typed collection of proposed operations and returns the exact
resulting diff without touching anything, and `apply_previewed_changes`
commits that previewed batch atomically or not at all. The preview must be
*honest* — the diff it reports is the diff applying actually produces —
and the batch must never land half-applied.

The layer is generic over EPIC-1006's operation registry: it works on
whatever typed operations the mutating epics (EPIC-1007 panels, EPIC-1009
screener, EPIC-1010 results, EPIC-1011 chart) have registered, including
operations registered after this code is written. There is no hardcoded
list of known operations anywhere in this epic, and no path that executes
arbitrary code, SQL, JavaScript, or DOM automation — the operation model
is typed end to end.

## User Story

As a researcher whose workspace an agent is editing,
I want to see exactly what a proposed batch of changes will do before any
of it happens, and to have it either land completely or not at all,
so that I can let an agent restructure my research session without risking
a half-broken workspace I cannot reason about or recover from.

## Ticket Summary

| # | Ticket | Title | Depends On | Status |
|---|--------|-------|------------|--------|
| 1 | T-1013-1 | Preview and apply domain contracts | — | Open |
| 2 | T-1013-2 | Non-mutating batch evaluation over the operation registry | T-1013-1 | Open |
| 3 | T-1013-3 | Structured workspace diff and diff summary | T-1013-1 | Open |
| 4 | T-1013-4 | Preview store with stable preview IDs and expiry | T-1013-1 | Open |
| 5 | T-1013-5 | Atomic apply with revision, idempotency, and undo | T-1013-2, T-1013-3, T-1013-4 | Open |
| 6 | T-1013-6 | Wire the two safety tools into the WebMCP surface | T-1013-5 | Open |

## Dependency Graph

```
                  ┌──> T-1013-2 ──┐
T-1013-1 ─────────┼──> T-1013-3 ──┼──> T-1013-5 ──> T-1013-6
                  └──> T-1013-4 ──┘
```

## Wave Plan

- **Wave 1**: T-1013-1 — the contracts everything else builds on
- **Wave 2** (parallel): T-1013-2, T-1013-3, T-1013-4 — evaluation, diff,
  and preview storage are independent of one another
- **Wave 3**: T-1013-5 — the atomic apply use case that composes them
- **Wave 4**: T-1013-6 — WebMCP tool registration and end-to-end tests

## Acceptance Criteria

1. A typed collection of proposed operations can be previewed, returning
   the resulting diff, the affected stable IDs, per-operation validation
   outcomes, and warnings — with the workspace's revision and contents
   provably unchanged afterwards.
2. Preview honesty: for any batch that previews successfully, applying it
   against the same revision produces exactly the diff, affected IDs, and
   summary the preview reported.
3. Applying a previewed batch is atomic — if any operation in the batch
   fails, the workspace is left identical to its pre-apply state and its
   revision does not advance.
4. A preview whose base revision no longer matches the live workspace is
   rejected at apply time with an error naming both the expected and the
   current revision; the workspace is untouched and the caller can
   re-preview.
5. A preview that contains validation failures reports every failure it
   can determine (not only the first) and cannot be applied.
6. A successful apply returns the common mutation envelope defined by
   EPIC-1006 — `change_id`, `new_revision`, `affected_ids`,
   `diff_summary`, `warnings`, `undo_token` — where the single
   `undo_token` reverses the entire batch as one unit.
7. Re-applying the same preview with the same `idempotency_key` returns
   the original result without mutating the workspace a second time or
   issuing a second `undo_token`.
8. Operations contributed to EPIC-1006's registry after this epic ships
   are previewable and applicable with no change to this epic's code —
   demonstrated by a test that registers a novel operation type and drives
   it through preview and apply.
9. Both tools are registered on the WebMCP surface with typed input
   schemas, are discoverable alongside the rest of the new surface, and
   accept only registered operation types — an unknown operation type is a
   validation failure, never a passthrough.
10. Nothing in the existing 11-tool pattern-research surface, its
    workspace store, or the current UI is modified; `main` stays
    deployable throughout.

## Design References

- `docs/reference/tool-spec.md` — the program's tool surface; the Safety row
  (`preview_workspace_changes`, `apply_previewed_changes`), the common
  mutation contract (`expected_revision`, `idempotency_key`, and the
  returned envelope), and the explicit exclusion of
  `set_application_state`, raw SQL/JavaScript, and DOM automation
- `docs/design/safety-preview-apply/spec.md` — behavioral spec for this
  epic (scenario tables for preview, apply, staleness, atomicity, undo)
- `docs/design/safety-preview-apply/technical.md` — the shadow-evaluation
  design that makes preview honesty structural, and the exact surface this
  epic consumes from EPIC-1006's registry
- `src/lib/webmcp/register.ts` — the existing registration/ownership
  pattern the wiring ticket should stay consistent with
- `src/lib/webmcp/tools.ts` — existing `ToolSpec`/`ToolResult` shaping
  conventions (`ok`/`fail`) to follow in new files

## What this epic needs from EPIC-1006

This epic is generic over EPIC-1006's registry and cannot be implemented
without the following. If EPIC-1006's shape differs, this epic adapts — it
must not re-implement any of it.

1. **Operation registry** — register a typed operation kind with a
   validator and a handler; look up a handler by kind; enumerate
   registered kinds. Registration must be possible after this epic's code
   is loaded.
2. **Pure handlers over an immutable workspace value** — a handler takes
   the current workspace state value plus a validated operation and
   returns the next state value, the affected stable IDs, and any
   warnings, performing no I/O and mutating nothing in place. This is what
   makes preview honesty structural rather than a promise.
3. **Revision model** — a monotonically advancing workspace revision, and
   the `expected_revision` precondition check.
4. **Idempotency** — the `idempotency_key` store that lets a repeated
   mutation return its original result.
5. **Undo tokens** — issuance and registration of an undo token that
   `undo_change` (EPIC-1014's tool, per the spec's Persistence row) can
   later redeem.
6. **The common mutation result envelope type** — `change_id`,
   `new_revision`, `affected_ids`, `diff_summary`, `warnings`,
   `undo_token`.

## Open questions

Recorded rather than escalated; each proceeds on the stated assumption
(see `docs/design/safety-preview-apply/spec.md` for the rationale).

1. **Preview lifetime.** `docs/reference/tool-spec.md` does not state how long
   a preview stays redeemable. *Assumption*: previews are session-scoped
   and in-memory with a bounded count and a TTL; expiry is a
   resource-hygiene measure only — safety comes from the revision check at
   apply time, never from the preview still existing.
2. **Un-previewed batch apply.** The spec names the tool
   `apply_previewed_changes`. *Assumption*: apply requires a preview ID;
   there is no path that applies an inline batch without a preview.
3. **Stale-preview rebasing.** *Assumption*: no automatic rebase. A preview
   whose base revision has moved is rejected and the agent re-previews,
   even when the batch would still be valid — silently re-targeting a diff
   the human approved at a different revision defeats the point of the
   preview.
4. **Undo granularity.** *Assumption*: one `undo_token` per applied batch,
   reversing the whole batch; individual operations within a batch are not
   separately undoable.
5. **Warnings vs. failures.** *Assumption*: warnings are advisory and do
   not block apply; failures block. A preview reporting only warnings is
   applicable as-is.

## Out of Scope

- The operation registry, revision model, idempotency store, undo-token
  issuance, and the common envelope type — all EPIC-1006.
- The `undo_change` tool itself and workspace persistence/history —
  EPIC-1014 per the spec's Persistence row.
- The individual mutating operations (panels, screener, chart, results) —
  EPIC-1007, EPIC-1009, EPIC-1010, EPIC-1011 contribute those to the
  registry.
- Any UI for reviewing a pending preview — this epic delivers the tool
  surface and its evaluation semantics only.
- Any change to, or retirement of, the existing 11-tool surface —
  EPIC-1015.
