# Workspace, Revisions & the Common Tool Contract — Behavioral Spec

**Epic**: EPIC-1006
**Source of truth**: `docs/reference/tool-spec.md`
**Status**: Derived from the program design doc, not from an intent
interview. Points the design doc does not settle are listed under
"Open questions" in `docs/plan/EPIC-1006/_epic.md` with a stated working
assumption.

## Problem

A human and an AI agent share one research workbench. The agent changes it
through tool calls; the human changes it by clicking. Without a contract
between them, three things go wrong constantly:

- The agent refers to "the third panel" and the human reorders the panels.
- The agent's call times out, it retries, and the workspace gets the same
  filter twice.
- The agent adds five filters and the human wants only the fifth removed,
  but nothing recorded what each change did.

The program's design doc answers all three with one contract: stable IDs,
`expected_revision` + `idempotency_key` on every mutation, and a fixed
result envelope carrying a change ID, the new revision, affected IDs, a
diff summary, warnings and an undo token. A fourth problem — an agent
quoting a price without saying whether it is live, delayed, adjusted, or
which currency it is in — is answered by a provenance record on every
market-data result.

This epic makes that contract real, once, so the other nine epics in the
program inherit it instead of each inventing their own.

## Who this is for

- **The agent** — needs to act without guessing, detect that the world
  moved, retry safely, and back out.
- **The human** — needs to see what the agent did in words, and undo it.
- **The sibling epics** — need one set of types and helpers to build on.

## Scenarios

### Reading the situation

**Ask what is going on.** The agent calls `get_app_context` and learns
which workspace is active, which screener is selected, which panel is
focused, what the surface is permitted to do, how delayed the data is,
what timezone the app is presenting, and the workspace's current revision.
It now has everything it needs to make a correctly-guarded first mutation.

**Ask what the workspace contains.** The agent calls `get_canvas_state` and
receives the panels, the layout, the links between panels, the active
symbol, the screener configuration, and whether there are changes not yet
saved under a name. Every item carries its stable ID.

### Changing things safely

**A guarded change succeeds.** The agent read revision 17. It sends a
mutation with `expected_revision: 17`. The workspace is still at 17, so the
change applies and the agent gets back change ID, `new_revision: 18`, the
IDs it touched, a sentence describing what changed, an empty warnings list,
and an undo token.

**A guarded change is refused.** The human dragged a panel between the
agent's read and its write, so the workspace is at 18. The agent's
`expected_revision: 17` no longer matches. Nothing is changed at all, and
the refusal tells the agent the current revision is 18 so it can re-read and
retry rather than guess.

**An unguarded change warns.** The agent omits `expected_revision`
entirely. The change applies — refusing would only push agents toward
worse behavior — but the envelope carries a warning saying the change was
applied without a concurrency check.

**A retry does not duplicate.** The agent's first call succeeded but the
response never arrived, so it re-sends the identical call with the same
`idempotency_key`. The workspace is not changed a second time, and the
agent receives the original envelope — same change ID, same revision, same
undo token — as though the first response had simply arrived late.

**A reused key with different content is refused.** The agent reuses an
`idempotency_key` for a genuinely different operation. This is a client
bug, so it is refused with an explicit conflict rather than silently
replaying the wrong result or silently applying the new one.

**Several changes commit as one.** A caller submits three operations
together. Either all three apply and produce one new revision with one
change ID, or the first failure aborts everything and the workspace is
exactly as it was.

### Backing out

**Undo the last thing.** The agent hands back the undo token from its last
mutation. That mutation is reversed, the workspace moves to a new revision,
and the reversal is itself recorded as a change — history grows, it never
shrinks.

**Undo twice is refused.** The same token is presented again. It is
rejected as already redeemed; the workspace is untouched.

**Undo something stale is refused.** The token belongs to a change that has
since been built on top of. Reversing it in isolation would corrupt the
state, so it is refused with an explanation pointing the caller at
restoring a revision instead.

**Read what happened.** The human or the agent asks for the change history
and gets an ordered list: change ID, revision, when, whether a human or an
agent did it, what changed in a sentence, and which IDs were affected.

**Go back to a known-good point.** A revision saved earlier under a name is
restored. The workspace's contents become that revision's contents, but the
restore moves the workspace *forward* to a new revision and is recorded as
a change like any other — so it can itself be undone.

### Naming a state worth keeping

**Create a workspace.** A blank workspace, or one seeded from a template,
is created with a stable ID and revision 1.

**Save under a name.** The current state is labelled. The label attaches to
the current revision rather than starting a separate numbering, so "the
version I saved as 'momentum draft'" and "revision 18" are the same thing
described two ways.

### Saying where data came from

**Every number is attributable.** Any result carrying market data states
its as-of time, its source, whether it is live or delayed, the timezone it
is expressed in, its currency, whether prices are split/dividend adjusted,
which reporting period any fundamentals belong to, and which version of the
calculation engine produced any derived values. An agent can therefore
never present a stale or unadjusted number as a current one without the
information being visible.

### Growing the surface

**A later epic adds an operation.** An epic outside this one defines a new
kind of change — adding a chart study, editing a filter tree — and
registers it. Without any edit to this epic's core modules, that operation
becomes previewable and applicable, obeys the same revision and idempotency
rules, and produces the same envelope. This is what makes EPIC-1013's
preview-then-apply flow possible over operations it does not itself define.

## What must remain true

1. No tool ever identifies a resource by position or by bare ticker.
2. No mutation ever partially applies.
3. A rejected mutation changes nothing.
4. Every applied mutation is undoable at the moment it is applied.
5. History is append-only; undo and restore add to it.
6. Every market-data result can state its provenance.
7. The existing 11-tool surface and its UI keep working; the app stays
   deployable.

## Explicitly not in this spec

- Any domain tool: screeners, charts, results, similarity, catalog,
  alerts, exports. Sibling epics own those and register operations here.
- The `preview_workspace_changes` / `apply_previewed_changes` tools
  themselves (EPIC-1013).
- A market-data provider. This spec defines what provenance must be
  stated, not who supplies it.
- Cross-device sync, multi-user concurrency, and server-side persistence.
- Trading in any form.
