# T-1008-7: Register the discovery tool group on the new surface

**Epic**: EPIC-1008 (Discovery & Catalog)
**Design**: docs/design/discovery-and-catalog/
**Status**: Open
**Depends on**: T-1008-4, T-1008-5, T-1008-6
**Blocks**: —

## Description

The three discovery tools exist but nothing hands them to a WebMCP bridge.
This ticket makes them one composable, self-contained tool group with an
explicit dependency list, so the new surface's eventual registration entry
point — and the sibling epics building the rest of that surface — can pick
it up without knowing anything about catalogs or instrument directories.
Done looks like: one exported builder that, given its dependencies, returns
the three ready tool specs, plus an integration test proving all three are
callable end to end.

## User Story

As the developer assembling the new WebMCP surface from several epics'
tool groups,
I want each group to expose one builder taking its explicit dependencies
and returning tool specs,
so that composing the full surface is a list of builder calls rather than a
merge negotiation between epics.

## Acceptance Criteria

1. One exported builder takes the discovery tools' dependencies explicitly
   as parameters and returns the three tool specs.
2. The builder's dependencies are passed in by the caller; the module holds
   no module-level singleton source, so a real reference-data adapter can be
   supplied later without editing this module or its callers' internals.
3. The three tools are declared in the same shape the existing bridge
   registration already consumes, so no change to the registration mechanism
   is needed to host them.
4. The three tools are always available — no availability predicate gates
   them behind workspace state, because discovery is what an agent does
   before there is any state.
5. The tool names exposed are exactly `search_instruments`,
   `search_catalog`, and `describe_catalog_item`, and a test asserts the
   exposed name set.
6. None of the three names collides with a name in the existing 11-tool
   surface, and a test asserts this so the two surfaces can coexist until
   EPIC-1015 retires the old one.
7. The existing 11-tool surface's registration path is unchanged, and the
   application's current behavior — including the header's tool count and
   the activity log — is identical whether or not this group is composed in.
8. An integration test exercises all three tools through the built specs,
   using the reference-data test double, and asserts each returns a
   well-formed result carrying provenance.
9. A round trip works end to end: searching the catalog for a term, taking a
   returned ID, and describing it returns that item's full detail.
10. Whether the group is actually registered on the live page is left to the
    new surface's composition root; if it is wired into the running app in
    this ticket, it is behind a flag that is off by default, so `main` stays
    deployable and current users see no change.

## Design References

- `src/lib/webmcp/register.ts` — the existing registration mechanism,
  `ToolSpec` consumption, ownership tracking, and the `available` predicate
  the new group deliberately does not use.
- `src/lib/webmcp/session.ts` — the bridge session state machine the new
  surface will eventually be composed into.
- `src/lib/webmcp/integration.test.ts` — the existing end-to-end tool test
  pattern to follow.
- `docs/design/discovery-and-catalog/technical.md` — the group's dependency
  list.
- `docs/reference/tool-spec.md` — the canonical tool names.

## Technical Considerations

- New files only. `register.ts`, `session.ts`, `tools.ts`, and
  `+page.svelte` are not modified — per the project's dead-code policy, new
  code in new files needs no flag, but any change to existing behavior does,
  which is why AC10 exists.
- This is the seam other epics in the program will merge against. Keep the
  builder signature small and the module free of anything but composition.
- Do not introduce a cross-epic shared registry module here; each epic owns
  its own group builder, and the composition root that combines them belongs
  to whichever epic owns the new surface's entry point.

## Out of Scope

- Replacing or removing the existing 11 tools (EPIC-1015).
- The new surface's composition root and page wiring.
- Any UI.
