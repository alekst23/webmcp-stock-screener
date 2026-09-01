# T-1009-1: Screener definition model and typed filter tree

**Epic**: EPIC-1009 (Screener Core)
**Design**: docs/design/screener-core/
**Status**: Open
**Depends on**: —
**Blocks**: T-1009-3, T-1009-4, T-1009-5

## Description

Every other ticket in this epic edits, validates, or executes the same
thing: a screener definition. This ticket introduces that definition as a
typed, browser-side model — the screener entity, its universe selection,
its filter tree, and its ranking — plus the stable-ID minting and
normalization the editing tools depend on. No tools and no evaluation
yet; this is the shape everything else agrees on.

## User Story

As a developer implementing the screener editing tools,
I want one typed screener model with stable IDs and safe normalization,
so that each editing tool changes state rather than inventing its own
representation of it.

## Acceptance Criteria

1. A screener can be represented with a stable ID, an owning workspace ID,
   an optional display name, a screener-local revision starting at 1, a
   universe selection, a filter tree, and an optional ranking.
2. The universe selection can carry asset class, exchanges, countries,
   sectors, industries, indexes, watchlists, liquidity limits (minimum
   price, minimum average volume, minimum market cap), and exclusions of
   instruments, sectors, and industries.
3. A filter tree node is either a group (`AND`, `OR`, or `NOT`, holding
   ordered children) or a condition, each with a stable node ID and an
   enabled/disabled flag; groups nest to arbitrary depth and a `NOT` group
   holds exactly one child.
4. Each of the eight condition types from the design spec is representable
   as its own typed variant, distinguishable at runtime without inspecting
   its contents.
5. No part of the model has a field capable of carrying SQL, JavaScript,
   or a free-form expression that would later be parsed or evaluated.
6. Minting a screener ID or node ID produces a value that is unique within
   its workspace and never collides with a previously retired ID in the
   same screener.
7. A malformed, foreign, or partially-corrupt serialized screener is
   normalized into a valid screener without throwing, matching the
   resilience the existing workspace persistence already provides.
8. A screener round-trips through serialization and normalization
   unchanged, including node IDs, node order, enabled flags, and nesting.
9. Unit tests cover each condition variant, arbitrary nesting, the `NOT`
   arity rule, ID uniqueness, and normalization of corrupt input.

## Design References

- `docs/design/screener-core/technical.md` — the definition, node, and
  condition shapes this ticket makes concrete, and the stable-ID prefixes.
- `docs/design/screener-core/spec.md` — "Create a screener", "Set the
  universe", and "Express eight condition types" scenarios.
- `src/lib/webmcp/types.ts` — the existing handle-based model style
  (summaries addressed by `id`) to follow.
- `src/lib/workspace/store.ts` — the existing `normalizeWorkspace`
  never-throw normalization pattern this mirrors.

## Technical Considerations

- New files only, beside the existing `src/lib/webmcp` and
  `src/lib/workspace` modules. Do not modify `types.ts`, `tools.ts`, or
  `store.ts`.
- Workspace IDs, revisions, and the mutation envelope come from EPIC-1006
  — reference them, do not re-declare them here.
- Catalog item identity (field, operator, study, pattern, interval IDs)
  comes from EPIC-1008. This ticket stores those IDs; it does not validate
  them (T-1009-6 does).

## Out of Scope

Tools, catalog validation, evaluation, and persistence wiring.
