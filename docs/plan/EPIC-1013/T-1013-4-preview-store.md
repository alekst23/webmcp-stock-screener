# T-1013-4: Preview store with stable preview IDs and expiry

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Done
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

## Implementation Plan

### Files

- `src/lib/workbench/infra/previewStore.ts` (new)
- `src/lib/workbench/infra/previewStore.test.ts` (new)

No existing file changes. The store is the epic's only infra component; it
imports from `domain/` only (`PreviewRecord`, `ResourceId`/`mintId`,
`Clock`) and never the reverse.

### Public surface

```ts
export type PreviewLookupStatus = 'found' | 'not_found' | 'expired' | 'consumed';

export interface PreviewLookup {
	status: PreviewLookupStatus;
	record?: PreviewRecord; // present only when status === 'found'
}

export interface PreviewStore {
	nextPreviewId(): ResourceId;
	put(record: PreviewRecord): PreviewRecord;
	get(previewId: ResourceId): PreviewLookup;
	markConsumed(previewId: ResourceId): void;
}

export function createPreviewStore(deps: {
	clock: Clock;
	randomToken?: () => string;
	ttlMs?: number;
	maxEntries?: number;
}): PreviewStore;
```

`nextPreviewId()` is separate from `put()` because a `PreviewResult`
carries its own `previewId`: the caller must know the ID before it can
build the record it stores.

### ID scheme (AC1, AC7)

`mintId('preview', seq, randomToken())` — e.g. `preview_a1b2c3d4_1`. The
random discriminator makes an ID unguessable; the monotonic sequence stays
the last segment so `parseId()` still resolves kind `'preview'`, and
guarantees no ID is ever reused even if the token repeats. `randomToken`
defaults to 8 hex chars from `crypto.getRandomValues` (falling back to
`Math.random` where crypto is absent) and is injected in tests so exact ID
strings can be asserted.

### Lifecycle and status (AC3, AC4, AC5)

One `Map<ResourceId, Entry>` where `Entry = { record, issuedAtMs,
sequence, consumed }`. `get` resolves in this order:

1. no entry → `not_found`
2. aged past `ttlMs` → delete the entry, return `expired` (so a second
   `get` cannot retrieve it either)
3. `consumed` → `consumed`, without returning the record
4. otherwise → `found` with the record

Expiry is checked before consumption so hygiene applies uniformly. A
consumed entry is *retained* (not deleted) so a second apply gets
`consumed`, not `not_found`. `markConsumed` on an unknown ID is a no-op —
the store does not adjudicate, it records.

### Time (AC7)

Every read of "now" goes through `Date.parse(clock.now())`. `Date.now()` is
never called, so tests advance a fake clock instead of waiting.

### Bounding (AC6)

At most `maxEntries` (default 50). Eviction removes the entry with the
smallest `(issuedAtMs, sequence)` tuple rather than trusting Map insertion
order, so a record put out of issue order can never displace a newer one.
Default `ttlMs` is 10 minutes, matching the spec's "a handful of minutes"
assumption.

### Dumbness (AC9)

The store answers only exists / consumed / aged out. It never inspects
`baseRevision`, `applicable`, or the diff — safety comes from the revision
check at apply time (T-1013-5); expiry is resource hygiene only.

### Storage (AC8)

A module-local `Map`. No `localStorage`, no `Storage` parameter, no
persisted key read or written; a test runs the whole lifecycle with
`globalThis.localStorage` deleted.

### Retrieval semantics

`get` returns the stored record by reference (no clone). Cloning on every
read would deep-copy a whole `WorkspaceDocument` candidate for a value
apply commits as-is; the contract is documented in a comment instead —
callers must not mutate a retrieved record.

### Test plan

- Round trip: `nextPreviewId` → build record → `put` → `get` returns that
  exact record and no other; two IDs never collide.
- Retrieved record carries base revision, candidate, diff, affected IDs,
  summary, warnings, applicability (AC2).
- `not_found` / `expired` / `consumed` reached by three distinct setups.
- Expiry drops: after `expired`, a second `get` also does not return it.
- Boundary: exactly at `ttlMs` is still live; one ms past is expired.
- Eviction: fill past `maxEntries`, oldest gone, every newer one survives;
  an out-of-order (older-issued) put is evicted before a newer one.
- Determinism: injected `randomToken` yields exact ID strings that
  `parseId` round-trips to kind `'preview'`.
- No-localStorage test; fakes keyed by identity; every assertion carries a
  message.
