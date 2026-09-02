# New WebMCP Surface

This doc covers the program-wide design of the ~33-tool WebMCP surface
rebuild (`docs/reference/tool-spec.md`), spanning EPIC-1006 through
EPIC-1015. It's for anyone implementing one of these epics, or wiring the
finished surface together, who needs the shape of the whole before reading
any one epic's code.

## Build alongside, cut over at the end

The new surface is built entirely in new files. The existing 11-tool
pattern-research surface (`src/lib/webmcp/tools.ts`, `src/lib/workspace/*`,
`src/routes/+page.svelte`) is left untouched by every epic in the program
except the last one, EPIC-1015, which retires it in a single user-gated
cutover. This keeps `main` deployable throughout construction — at any point
during the program, the shipped app is still the old 11-tool surface, and
the new one exists alongside it, unregistered, until cutover.

## Per-epic tool-group builders

Each epic that adds tools exposes one function, `build<Area>Tools(deps)`,
that takes its dependencies as explicit parameters (no module-level
singletons) and returns a `ToolSpec[]`. EPIC-1008 established the pattern
with `buildDiscoveryTools(deps)` in `src/lib/webmcp/discovery/group.ts`;
EPIC-1006's own workspace tool surface (`buildWorkbenchTools`) follows the
same shape. Building this way means composing the full surface is meant to
end up as a flat list of builder calls, not a merge negotiation between
epics — each epic's tools are fully self-contained and testable without the
others.

## Surface-shared contract modules

`docs/reference/tool-spec.md` specifies one contract every tool in the new
surface must obey: stable resource IDs (never a bare ticker or a
positional name like "panel 3"), and — for any result touching market or
reference data — a provenance envelope stating `as_of`, source, live/delayed
status, timezone, and (where applicable) currency, price-adjustment policy,
and fundamentals reporting period.

Two modules under `src/lib/surface/` implement this contract once, for the
whole surface, rather than per-epic:

| Module | Provides | Notes |
|--------|----------|-------|
| `src/lib/surface/ids.ts` | `makeInstrumentId`/`isInstrumentId` (`inst:<MIC>:<SYMBOL>`), `makeCatalogItemId`/`isCatalogItemId` (`<prefix>.<segment>` for field/op/study/indicator/pattern/interval/universe/template) | No workspace/panel/screener/run ID makers yet — that's expected to land as EPIC-1006 extends this module rather than starting a second one |
| `src/lib/surface/provenance.ts` | `DiscoveryEnvelope<T>`, `envelope<T>()`, plus re-exports of EPIC-1006's `MarketDataProvenance`/`makeProvenance()` | Covers every field tool-spec.md's common contract requires for market-data results |

Both modules were built by EPIC-1008 (Discovery & Catalog), whose own tools
needed them first, but they're deliberately scoped to the whole surface, not
to discovery — sibling epics are expected to extend `ids.ts` with their own
resource-ID makers and reuse `MarketDataProvenance`/`envelope<T>()` rather than each
defining their own version. Whether that reuse actually happens as each
epic lands is worth checking at each epic's review.

The provenance record itself lives one layer in, at
`src/lib/workbench/domain/provenance.ts`: EPIC-1006 owns the common tool
contract, and for a while the two epics shipped two incompatible provenance
types in parallel. `src/lib/surface/provenance.ts` now re-exports the
canonical one and adds only what is genuinely discovery-specific — the
`warnings` array on `DiscoveryEnvelope<T>`.

## The composition root — currently unowned

Per-epic builders only produce tool lists; nothing yet imports every epic's
`build<Area>Tools`, concatenates the results, and registers them on the live
page. As of EPIC-1008's close, no ticket in EPIC-1006 through EPIC-1015
does this — EPIC-1006's own tool-surface ticket registers only its own
tools, and EPIC-1015's cutover tickets presuppose the new surface is already
assembled rather than assembling it. This is a real, program-level gap
(tracked in `docs/plan/project.md`'s Blockers table), not a defect in any
one epic — each epic correctly stayed in its own scope. It needs an explicit
owner before EPIC-1015's cutover can happen: something that imports every
epic's builder, wires real dependencies, and registers the combined tool
list where `src/lib/webmcp/tools.ts`'s `buildTools()` is registered today.

## References

- `docs/reference/tool-spec.md` — the tool inventory and common contract
- `docs/plan/project.md` — program status, wave order, and the
  composition-root blocker
- `src/lib/webmcp/discovery/group.ts` — the reference implementation of the
  per-epic builder pattern
- `src/lib/surface/ids.ts`, `src/lib/surface/provenance.ts` — the
  surface-shared contract modules
