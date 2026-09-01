# T-1013-1: Preview and apply domain contracts

**Epic**: EPIC-1013 (Safety layer (preview & apply))
**Design**: docs/design/safety-preview-apply/
**Status**: Open
**Depends on**: — (consumes EPIC-1006's registry and envelope types)
**Blocks**: T-1013-2, T-1013-3, T-1013-4

## Description

Define the pure data contracts the rest of the epic is built from: what a
proposed change batch is, what a preview result contains, how validation
failures and warnings are represented, and what errors preview and apply
can return. No behavior, no I/O — just the vocabulary, so the three Wave 2
tickets can be built in parallel against a shared shape.

## User Story

As a developer implementing evaluation, diffing, and preview storage in
parallel,
I want one agreed set of types for batches, previews, diffs, and failures,
so that the three pieces compose without rework and the tool layer has a
single payload shape to serialize.

## Acceptance Criteria

1. A proposed change batch is representable as an ordered collection of
   operations, each carrying an operation kind and its typed arguments,
   with the batch's ordering significant.
2. An operation's kind is expressed as a registry key, not a member of a
   closed enumeration — adding a kind requires no change to these types.
3. A preview result is representable with: a stable preview ID, the
   revision it was computed against, a structured diff, the affected
   stable IDs, a human-readable summary, warnings, per-operation outcomes,
   and whether the preview is applicable.
4. A validation failure identifies the offending operation by its position
   in the batch and its kind, and carries a human-readable reason; a batch
   can hold more than one.
5. Warnings and failures are distinct types — a preview carrying only
   warnings is applicable; one carrying any failure is not.
6. A structured diff is representable as an ordered list of typed entity
   changes (added, removed, updated), each naming the entity's stable ID,
   with updates carrying the changed fields' before and after values.
7. The error cases preview and apply can return are enumerable and
   distinguishable by a caller: unknown preview, expired preview, stale
   revision, precondition mismatch, already applied, not applicable, and
   invalid input.
8. The contracts are pure data with no imports from any infrastructure or
   UI module, and no dependency on the existing eleven-tool surface.

## Design References

- `docs/design/safety-preview-apply/spec.md` — the guarantees these types
  must be able to express, and the scenario tables they must cover
- `docs/design/safety-preview-apply/technical.md` — "Diff shape" and the
  layering table
- `docs/reference/tool-spec.md` — the common mutation contract these types
  interoperate with
- `src/lib/webmcp/types.ts` — the project's existing convention for
  declaring a tool surface's data contracts

## Technical Considerations

Consume EPIC-1006's operation-registry and mutation-envelope types rather
than restating them; if EPIC-1006 has not landed the exact names yet,
depend on the capability and adapt when it does. Types only — anything
that reads a clock, generates an ID, or touches storage belongs to a later
ticket.

## Out of Scope

Evaluation, diffing, storage, and tool registration.
