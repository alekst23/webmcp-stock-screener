# T-1006-11: Boundary logging, cross-tab write race, and re-serialization cost

**Epic:** EPIC-1006
**Status:** Open

## Goal

Three related operational-robustness gaps surfaced by epic review, none
severe enough to block merge on their own:

1. **No structured logging at infra/application boundaries.**
   `workspaceRepository.ts` and `revisionService.ts`/`recordCommit` never log
   operation name, workspace ID, or duration. Typed errors reach the calling
   agent fine via `toErrorResult()`, but a human debugging via devtools
   console has nothing to go on when e.g. a `localStorage` write throws.
2. **Cross-tab TOCTOU race, undocumented.** `RevisionService.commit`'s
   expected-revision check (read) and `recordSuccess`'s write are not atomic
   across two browser tabs sharing the same `localStorage` -- two tabs that
   both read revision 5 can both compute revision 6 and the second write
   silently clobbers the first. The epic's Out of Scope excludes "multi-user
   concurrency" and "cross-device persistence" but frames revisions as
   correct "per-browser," which two open tabs of the same browser arguably
   falls under. At minimum, document the gap explicitly; consider a
   `storage` event listener or Web Locks guard if it proves to matter.
3. **Full-blob re-serialization per commit.** `workspaceRepository.ts`'s
   `put()`/`putRevision()` read and rewrite the entire workspaces/revisions
   index on every single mutation, not just the changed workspace's slice.
   Likely fine at today's data sizes; worth revisiting if "many workspaces"
   becomes a real usage pattern.

## Acceptance criteria

- Structured log lines (or an agreed lightweight equivalent) at the
  repository/revision-service write boundaries, including operation name,
  workspace ID, and outcome.
- The cross-tab race is either mitigated or explicitly documented in
  `docs/design/workspace-revisions/technical.md`'s scope/limitations.
- A note (doc or ticket) tracking the re-serialization cost as a known,
  currently-acceptable tradeoff.
