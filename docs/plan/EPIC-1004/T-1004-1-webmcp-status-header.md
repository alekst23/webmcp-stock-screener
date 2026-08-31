# T-1004-1: WebMCP connection status in the page header

**Design**: docs/design/pattern-research-workbench/
**Status**: Open
**Depends on**: —
**Blocks**: —
**Issue**: #4

## Description

The page header gives no indication of whether WebMCP is active or how
many tools are registered. Add status text like "WebMCP connected · 11
tools available" using data already available: tool count from
`buildTools(engine).length` (static full surface, not what's currently
unlocked), and connection state from whether `connectWebmcp()` found
`document.modelContext`.

## User Story

As a user or judge looking at the page,
I want to see at a glance whether WebMCP is active and how many tools the
app defines,
so that I can tell the page is WebMCP-capable and tools registered
successfully without opening dev tools.

## Acceptance Criteria

1. On page load, the header shows connection status and the total tool
   count (e.g. "WebMCP connected · 11 tools available") when
   `document.modelContext` is present and `connectWebmcp()` succeeds.
2. When the browser doesn't support `document.modelContext`, the header
   shows that WebMCP isn't available in this browser, rather than a
   misleading "connected" state.
3. The tool count reflects the full defined tool surface
   (`buildTools(engine).length`), not how many are currently unlocked by
   workflow state (feature #10's progressive availability is unaffected
   by this ticket).
4. Resolves #4.

## Design References

- `docs/design/pattern-research-workbench/spec.md` — "WebMCP status
  visible" / "Not WebMCP-capable" scenarios (feature #9)
- `src/routes/+page.svelte`, `src/lib/webmcp/register.ts` (`connectWebmcp`'s
  return value), `src/lib/webmcp/tools.ts` (`buildTools`)

## Solution Approach

Left to ticket design — likely reads `connectWebmcp()`'s resolved value
(non-null vs. null) and `buildTools(engine).length` in `+page.svelte`'s
`onMount`, rendering the result inline in the header.

## Out of Scope

Reflecting progressive tool availability dynamically in the count.
