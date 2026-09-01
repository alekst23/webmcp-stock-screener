# T-1013-4: Preview store with stable preview IDs and expiry

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Open
**Depends on**: T-1013-1
**Blocks**: T-1013-5

## Description

Hold computed previews between the preview call and the apply call. Each
stored preview keeps the base revision it was computed against, the
candidate state, the diff, and whether it is applicable — so apply can
commit the exact outcome that was reported rather than recomputing it.
Bounded in size and age so a long session cannot accumulate previews
without limit.

## User Story

As the apply path,
I want to retrieve the precise candidate state and diff a given preview
produced,
so that applying commits what was reported and can detect a preview that
was already used or has aged out.

## Acceptance Criteria

1. Storing a preview returns a stable, unguessable preview ID that
   retrieves that preview and no other.
2. A retrieved preview carries everything apply needs: the base revision,
   the candidate state, the structured diff, the affected IDs, the
   summary, the warnings, and its applicability.
3. Retrieving an ID that was never issued reports not-found, distinctly
   from expired.
4. A preview can be marked consumed; retrieving a consumed preview reports
   already-applied rather than returning it for a second commit.
5. Previews expire after a configured age; retrieving an expired preview
   reports expired and it is no longer retrievable afterwards.
6. The store holds at most a configured number of previews, evicting the
   oldest first; eviction never removes a newer preview to make room for
   an older one.
7. Time and ID generation are injected, so tests can advance the clock and
   assert exact IDs without waiting or sampling randomness.
8. Storage is per-session and in-memory; nothing is written to
   `localStorage` or any persisted store, and no existing persisted key is
   read or written.
9. Expiry and eviction are resource limits only — no acceptance criterion
   of this epic's safety guarantees depends on a preview having expired.

## Design References

- `docs/design/safety-preview-apply/spec.md` — "Apply a previewed batch"
  rows for expired, unknown, and already-applied previews; open question 1
  on preview lifetime
- `docs/design/safety-preview-apply/technical.md` — the layering table
  (this is the epic's only infra-layer component)
- `src/lib/workspace/snapshots.ts` — the project's existing convention for
  an injected-storage module with deterministic tests

## Technical Considerations

Safety comes from the revision check at apply time, not from expiry. Keep
the store dumb: it must not decide whether a preview is safe to apply,
only whether it exists, is consumed, or has aged out.

## Out of Scope

The revision check, commit, idempotency, and undo (T-1013-5).
