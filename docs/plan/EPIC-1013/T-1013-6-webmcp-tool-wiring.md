# T-1013-6: Wire the two safety tools into the WebMCP surface

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Open
**Depends on**: T-1013-5
**Blocks**: —

## Description

Expose `preview_workspace_changes` and `apply_previewed_changes` on the
new WebMCP tool surface with typed input schemas, and prove the whole
safety layer end to end from a tool call rather than only at the use-case
boundary. This is the epic's wiring ticket — after it, an agent connected
to the app can gate its own changes.

## User Story

As an AI agent connected to the workbench,
I want the preview and apply tools to appear on the tool surface with
schemas that tell me how to describe a proposed batch,
so that I can propose changes, read the diff, and commit them without
guessing the payload shape.

## Acceptance Criteria

1. `preview_workspace_changes` and `apply_previewed_changes` are
   registered on the new tool surface and appear in its tool listing.
2. `preview_workspace_changes` accepts an ordered batch of operations,
   each naming a registered operation kind and its arguments, and returns
   the preview payload as structured, parseable content.
3. `apply_previewed_changes` accepts a preview ID plus the optional
   `expected_revision` and `idempotency_key` from the common mutation
   contract, and returns the common mutation envelope.
4. The tool descriptions and the operation-kind schema are generated from
   the live registry, so kinds contributed by other epics are described to
   the agent without editing this code.
5. An operation kind absent from the registry is reported as a validation
   failure in the preview result; it is never forwarded to any handler and
   never executed.
6. Every failure case — unknown preview, expired preview, stale revision,
   precondition mismatch, already applied, not applicable, invalid input —
   returns a tool error whose message identifies which case occurred, and
   mutates nothing.
7. An end-to-end test drives preview then apply through the tool interface
   and asserts the applied envelope matches the preview's reported diff,
   affected IDs, and summary.
8. An end-to-end test registers an operation kind that this epic's source
   never references and drives it through both tools successfully.
9. No tool accepts free-form state, code, SQL, JavaScript, or DOM
   instructions; the only mutating input either tool takes is a batch of
   registered typed operations or a preview ID.
10. The existing eleven-tool pattern-research surface, its workspace
    store, and the current UI are unchanged, and the app still builds and
    passes its existing tests.

## Design References

- `.dev/design/tool-spec.md` — the two Safety-row tool names and the
  exclusion list this ticket must honour
- `docs/design/safety-preview-apply/spec.md` — the scenario tables the
  end-to-end tests should mirror
- `src/lib/webmcp/register.ts` — the registration and ownership pattern
  (generation tracking, dispose semantics) to stay consistent with
- `src/lib/webmcp/tools.ts` — `ok`/`fail` result shaping and schema
  declaration conventions
- `src/lib/webmcp/integration.test.ts` — the existing end-to-end test
  pattern against a fake bridge

## Technical Considerations

New files only. The registration surface these tools join is EPIC-1006's;
do not add them to the existing `buildTools` list, which EPIC-1015 retires.

## Out of Scope

Any UI for reviewing a pending preview; retiring the old tool surface
(EPIC-1015).
