# T-1006-5: Optimistic concurrency and idempotency replay

**Epic**: EPIC-1006 (Workspace, Revisions & the Common Tool Contract)
**Design**: docs/design/workspace-revisions/
**Status**: Done
**Depends on**: T-1006-1, T-1006-2, T-1006-4
**Blocks**: T-1006-6, T-1006-7

## Description

This is the heart of the epic: the single write path every mutation in the
program goes through. It enforces `expected_revision`, replays a repeated
`idempotency_key` instead of applying a change twice, increments the
revision, snapshots the result and returns the mutation envelope. Once this
exists, no other module in the program ever increments a revision or
decides whether a write is safe.

## User Story

As an agent whose call may race a human's click or time out and be retried,
I want the workbench to refuse a write against a revision I no longer hold
and to recognize a retry of a write it already applied,
so that I never silently clobber the human's change or duplicate my own.

## Acceptance Criteria

1. A mutation supplying an expected revision matching the workspace's
   current revision applies, and the returned envelope reports a revision
   exactly one higher.
2. A mutation supplying an expected revision that does not match is
   refused with a revision-conflict error stating both the expected and the
   actual current revision, and the stored workspace is byte-for-byte
   unchanged.
3. A mutation omitting an expected revision applies, and its envelope
   carries a warning stating the change was applied without a concurrency
   check.
4. Repeating a mutation with an idempotency key already recorded for an
   identical request returns the originally recorded envelope — same change
   ID, same revision, same undo token — and the workspace's revision does
   not advance.
5. Reusing an idempotency key for a materially different request is
   refused with an idempotency-conflict error, and no change is applied.
6. A mutation whose state change throws leaves the stored workspace and its
   revision unchanged, and records nothing in the idempotency cache.
7. The idempotency cache is bounded in both entry count and age, and
   evicting an entry causes a later retry to be treated as a new request
   rather than crashing.
8. Every successful mutation stores a revision snapshot for the new
   revision and updates the workspace's last-updated timestamp.
9. Every successful mutation mints a change ID and, when the caller
   supplies an inverse, an undo token; when no inverse is supplied the
   envelope reports the change as not undoable.
10. Time and ID generation are injected rather than read from globals, so
    the same input produces the same envelope in tests.

## Design References

- `docs/reference/tool-spec.md` — "Common contract for every tool" states the
  `expected_revision` / `idempotency_key` requirement this implements.
- `docs/design/workspace-revisions/spec.md` — the "Changing things safely"
  scenarios are the behavior under test here.
- `docs/design/workspace-revisions/technical.md` — "T-1006-5" section gives
  the `RevisionService`, `MutationDraft` and `IdempotencyCache`
  signatures.

## Solution Approach

`idempotency.ts`: `createIdempotencyCache({maxEntries=200, ttlMs=3.6e6})`
is a `Map<key, {fingerprint, envelope, expiresAt}>` with insertion-order
eviction once over `maxEntries` and lazy expiry-check on `lookup`.
`lookup(key, fingerprint)` returns the stored envelope on a fingerprint
match, throws `IdempotencyConflictError` on a mismatch, and returns `null`
on a miss (new or evicted key) — an evicted retry is therefore
indistinguishable from a first call, satisfying AC7. The fingerprint
itself is computed by the caller (`revisionService.ts`) as a stable hash
(sorted-key JSON stringify, not raw `JSON.stringify`, so key order never
matters) of `{operationKind, input}`.

`revisionService.ts`'s `commit` is decomposed to stay under 30-40 lines:
a `checkExpectedRevision` guard (throws `RevisionConflictError` with both
revisions on mismatch), a `checkIdempotency` guard (returns the replayed
envelope or proceeds), and the core apply step — call `mutate(currentDoc)`,
catch any throw and rethrow after guaranteeing no repository write
happened, then on success: bump `revision`, stamp `updatedAt`, `repository.put`,
`repository.putRevision`, mint a change ID via `ids.next('change')`, mint an
undo token via `ids.next('undo')` only when `draft.inverse` is present,
append the missing-`expected_revision` warning when
`context.expectedRevision` is `undefined`, then `idempotency.remember(...)`
and return `buildEnvelope(...)`. Time comes from an injected `Clock` port
(`{ now(): string }`) and IDs from the injected `IdSequencer`, never
`Date.now()`/`crypto.randomUUID()` directly, so tests are deterministic.

**Contracts introduced:** `RevisionService`, `MutationDraft`,
`createRevisionService`, `IdempotencyCache`, `createIdempotencyCache`,
`Clock` (port) — `src/lib/workbench/application/revisionService.ts` and
`.../application/idempotency.ts`; `Clock` port in `domain/ports.ts`.

## Technical Considerations

- Modules: `src/lib/workbench/application/revisionService.ts` and
  `src/lib/workbench/application/idempotency.ts`.
- Exported contract surface other epics depend on: `RevisionService`,
  `MutationDraft`, `createRevisionService`, `IdempotencyCache`,
  `createIdempotencyCache`, and the `Clock` port.
- `commit` is the program's only write path. Sibling epics must call it
  rather than writing through the repository directly; make that explicit
  in the module's leading comment.
- "Materially different request" needs a defined fingerprint — a stable
  hash of the operation kind and its normalized input. Two calls differing
  only in key ordering must fingerprint identically, or honest retries will
  be rejected as conflicts.
- The missing-`expected_revision` warning is a deliberate choice over
  rejection (see the epic's Open Questions); the warning text is part of
  the contract sibling epics surface to users, so keep it stable.
- Keep `commit` under the project's 30-40 line limit by extracting the
  guard checks; it will otherwise grow past it as warnings accumulate.
- Tests must prove each rejection path leaves state untouched, not merely
  that it throws — assert the stored revision afterwards.

## Out of Scope

Undo redemption and the change log (T-1006-6), multi-operation folding
(T-1006-7), and tools (T-1006-8). This ticket records the inverse a caller
supplies; it does not yet redeem one.
