# T-1004-1: WebMCP connection status in the page header

**Design**: docs/design/pattern-research-workbench/
**Status**: Implemented (pending review/close)
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

Implements the "WebMCP status visible" and "Not WebMCP-capable" scenarios
from `spec.md`'s Shared workspace & collaboration feature (#9).

- **Layer**: frontend only (`src/lib/webmcp/`, `src/routes/+page.svelte`).
- New pure function `formatWebmcpStatus(status: WebmcpStatus): string` in
  `src/lib/webmcp/status.ts` — takes `{ connected: boolean; toolCount:
  number }` and returns the header text ("WebMCP connected · N tools
  available" or "WebMCP isn't available in this browser"). Pure and
  synchronous so it's unit-testable without a Svelte component-testing
  library (none is in `package.json`; existing WebMCP tests only exercise
  plain TS, e.g. `tools.test.ts`).
- `+page.svelte`'s `onMount` computes `toolCount` from
  `buildTools(engine).length` (static full surface — AC3, feature #10 out
  of scope) and awaits `connectWebmcp()`; `connected` is `connectWebmcp()`'s
  result being non-null (it returns `null` exactly when
  `document.modelContext` is absent — see `register.ts`). Both feed a
  `$state` `WebmcpStatus` object rendered via `formatWebmcpStatus` inline
  in the header markup.
- No backend, domain, or infra changes — this ticket is presentation over
  data `register.ts`/`tools.ts` already expose.

### Contracts to introduce

- `WebmcpStatus` (type) → `src/lib/webmcp/status.ts` — `{ connected:
  boolean; toolCount: number }`, the input to `formatWebmcpStatus`.
- `formatWebmcpStatus(status: WebmcpStatus): string` → same file — pure
  formatter, stubbed in this phase (throws), implemented in
  `/at-ticket-start`.

### Config vars introduced

None.

### References

- `src/routes/+page.svelte` — renders the header, owns `onMount`
- `src/lib/webmcp/register.ts` — `connectWebmcp()` return value contract
- `src/lib/webmcp/tools.ts` — `buildTools()`
- `docs/design/pattern-research-workbench/technical.md` — contract entry
  added by this phase

## Out of Scope

Reflecting progressive tool availability dynamically in the count.
