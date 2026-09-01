# Safety Layer (Preview & Apply) — Product Spec

## Intent

An agent operating the research workbench can propose a batch of changes
that restructures a researcher's entire workspace in a single turn. Left
unguarded, the researcher finds out what the agent intended only after it
already happened, and a batch that fails halfway leaves a workspace nobody
can reason about.

This feature adds the gate. `preview_workspace_changes` takes a typed
collection of proposed operations, evaluates them against the current
workspace, and returns the exact resulting diff — without changing
anything. `apply_previewed_changes` then commits that previewed batch
atomically: whole, or not at all.

Done looks like: an agent can say "here is what I am about to do", the
answer is trustworthy, and the researcher's workspace is never left in a
state the preview did not describe.

## Preconditions

- A workspace exists and has a current revision (EPIC-1006).
- The operation kinds being proposed are registered in EPIC-1006's
  operation registry by the epics that own them (EPIC-1007 panels,
  EPIC-1009 screener, EPIC-1010 results, EPIC-1011 chart).

## Core guarantees

These are the properties the feature exists to provide. Every scenario
below is in service of one of them.

1. **Honesty** — the diff a successful preview reports is exactly the diff
   applying it produces.
2. **Non-mutation** — preview never changes workspace contents or its
   revision, for any input, valid or not.
3. **Atomicity** — an applied batch lands whole or not at all. There is no
   observable intermediate state.
4. **Freshness** — a batch is only ever applied against the revision it
   was previewed against.
5. **Typed operations only** — an unrecognised operation kind is a
   validation failure. There is no generic state-setting, no arbitrary
   code, SQL, or JavaScript execution, and no DOM automation.
6. **Reversibility** — an applied batch is reversible as a single unit via
   its undo token.

## Features

1. **Preview a proposed batch**: validate a typed collection of operations
   and return the resulting diff, affected IDs, per-operation outcomes,
   and warnings, changing nothing.
2. **Apply a previewed batch**: atomically commit a previously previewed
   batch and return the common mutation envelope.
3. **Reject stale previews**: refuse to apply a preview whose base
   revision has moved on.
4. **Report validation problems without mutating**: surface every
   determinable failure and warning at preview time.
5. **Undo an applied batch**: reverse a whole applied batch through the
   undo token it returned.

## Behavioral Specifications

### Preview a proposed batch

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a workspace at some revision and a batch of valid registered operations | the batch is previewed | a preview ID, the base revision, the structured diff, the affected stable IDs, a human-readable summary, and any warnings are returned |
| Nothing changed | a workspace and a batch whose operations are all no-ops against current state | the batch is previewed | the preview succeeds and reports an empty diff rather than failing |
| No mutation | any workspace and any batch, valid or not | the batch is previewed | the workspace's contents and revision are identical before and after the call |
| Ordered evaluation | a batch where a later operation depends on an earlier one (e.g. add a panel, then configure it) | the batch is previewed | operations are evaluated in the order given, and the later one sees the earlier one's effect |
| Empty batch | a workspace | an empty batch is previewed | the call is rejected as invalid input; no preview is created |
| Late-registered operation | an operation kind registered after the safety layer was built | a batch using it is previewed | it previews exactly like any other registered kind, with no change to the safety layer |

### Report validation problems without mutating

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Unknown operation kind | a batch containing an operation kind not in the registry | the batch is previewed | the preview reports a validation failure naming that operation's position and kind, and is not applicable |
| Malformed operation | a batch containing a registered kind with arguments its validator rejects | the batch is previewed | the preview reports the failure with the reason from the validator, and is not applicable |
| Multiple failures | a batch with more than one independently invalid operation | the batch is previewed | every determinable failure is reported, not only the first |
| Failure after a valid prefix | a batch whose third operation fails validation | the batch is previewed | the earlier operations' evaluation is reported, the third is reported as failed, and the whole preview is not applicable |
| Warnings only | a batch that is valid but whose operations raise advisory warnings | the batch is previewed | the warnings are returned and the preview is still applicable |
| Unknown preview | no such preview ID | a preview ID is looked up or applied | the call fails with a not-found error and the workspace is untouched |

### Apply a previewed batch

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a valid preview whose base revision is still current | it is applied | the workspace advances by one revision, and the common envelope is returned with `change_id`, `new_revision`, `affected_ids`, `diff_summary`, `warnings`, and `undo_token` |
| Matches the preview | a valid preview | it is applied | the returned diff summary and affected IDs match what the preview reported exactly |
| Not applicable | a preview containing validation failures | it is applied | the call fails, the workspace is untouched, and its revision does not advance |
| Atomic on failure | a preview whose operations still validate but where one fails during commit | it is applied | no part of the batch is visible in the workspace, and the revision does not advance |
| Consumed once | a preview that was applied successfully | it is applied again without an idempotency key | the call fails as already-applied; the workspace is not mutated a second time |
| Idempotent retry | a preview applied with an idempotency key | the same apply is repeated with the same key | the original result is returned verbatim, with no second mutation and no second undo token |
| Expired preview | a preview that has aged out of the preview store | it is applied | the call fails as not-found and the caller is directed to re-preview; the workspace is untouched |

### Reject stale previews

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Revision moved | a preview taken at revision N, and the workspace has since advanced to N+1 | the preview is applied | the call fails with a stale-preview error naming both the previewed revision and the current one; the workspace is untouched |
| Explicit expectation mismatch | an apply call carrying an `expected_revision` that is neither the preview's base nor the current revision | it is applied | the call fails with a precondition error; the workspace is untouched |
| Still-valid batch, moved revision | a preview whose operations would still be valid against the new revision | it is applied after the revision moved | it is still rejected — the diff the human saw was computed against a revision that no longer exists, so it must be re-previewed |
| Re-preview after staleness | a rejected stale preview | the same operations are previewed again | a fresh preview is returned against the current revision, which then applies successfully |

### Undo an applied batch

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Whole-batch reversal | a batch of several operations applied together | its undo token is redeemed | every operation in the batch is reversed together and the workspace returns to its pre-apply contents |
| One token per batch | a batch of several operations applied together | the apply returns | exactly one undo token is issued for the batch, not one per operation |
| Failed apply issues nothing | an apply that failed for any reason | the call returns | no undo token is issued, because nothing was applied |

## Assumptions and open questions

`docs/reference/tool-spec.md` is the source of truth and does not settle the
following. Each proceeds on the stated assumption; revisit only if the
program's owner says otherwise.

1. **Preview lifetime** — not specified. *Assumption*: previews live in
   memory for the session, bounded by a TTL and a maximum count. Expiry is
   resource hygiene, never a safety mechanism: safety comes from the
   revision check at apply time. A preview that survives forever is still
   safe; a preview that expires early only costs a re-preview.
2. **Un-previewed batch apply** — the tool is named
   `apply_previewed_changes`. *Assumption*: apply always takes a preview
   ID. There is no inline-batch apply path, because such a path would let
   an agent skip the gate this epic exists to install.
3. **Stale-preview rebasing** — *Assumption*: never auto-rebase. Silently
   re-targeting a diff onto a revision the reviewer never saw would break
   the honesty guarantee, which is the whole point.
4. **Undo granularity** — the spec's `undo_change` reverses "a mutation".
   *Assumption*: a batch is one mutation, so one token reverses it whole.
   Per-operation undo would let a caller reassemble exactly the
   half-applied state atomicity forbids.
5. **Warnings vs. failures** — *Assumption*: warnings are advisory and do
   not block apply; failures do. Otherwise there would be no meaningful
   difference between the two.

## Non-Goals

- Defining the operation registry, revision model, idempotency store, or
  undo-token machinery — those belong to EPIC-1006.
- Defining any individual operation's semantics — the mutating epics own
  those.
- The `undo_change` tool itself — EPIC-1014.
- A human-facing UI for reviewing a pending preview.
- Cross-session or cross-device preview sharing.
- Any generic state-setting, arbitrary code execution, or DOM automation
  path — explicitly excluded by `docs/reference/tool-spec.md`.
