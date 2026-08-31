# T-1002-4: Validate persisted activity log shape on load

**Epic:** EPIC-1002
**Status:** Open

## Goal

Epic review of EPIC-1002 found that `readPersisted` in `src/lib/workspace/activity.ts`
catches `JSON.parse` failures but never validates the parsed value's shape before
`nextIdAfter` iterates it. Since `activityStore` is constructed as a module-level
singleton at import time, any non-array valid JSON under the `webmcp-activity-log`
localStorage key (`{}`, a stray string, or a future schema change) throws during
module init and can crash the whole app on load — not just the activity feature.
`store.ts`'s equivalent workspace-state loader already validates shape (it
normalizes duplicate persisted ids instead of crashing); `activity.ts` should follow
the same defensive pattern.

## Acceptance criteria

- `readPersisted` in `activity.ts` validates that the parsed value is an array of
  well-formed activity events before using it, falling back to an empty log (matching
  the existing corrupted-JSON fallback) on any shape mismatch — never throwing during
  module init.
- A test exercises a shape-mismatch case (e.g. `localStorage` holding `"{}"` or a
  non-array JSON value under the activity log key) and asserts the store falls back
  to an empty log rather than throwing.
