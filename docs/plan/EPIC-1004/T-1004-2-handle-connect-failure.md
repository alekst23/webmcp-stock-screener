# T-1004-2: Handle WebMCP connect failure and remount in the status header

**Epic:** EPIC-1004
**Status:** Open

## Goal

Epic review of EPIC-1004 found (independently, by 3 of 5 review agents) that
`+page.svelte`'s `onMount` calls `connectWebmcp(engine, activityStore).then(...)`
with no `.catch()`. `connect()` in `register.ts` awaits `engine.getWorkspace()`
and `mc.registerTool(...)`, either of which can reject in a genuine
WebMCP-capable browser (network error, malformed tool descriptor). On
rejection, `webmcpStatus` stays `null` forever and the `{#if webmcpStatus}`
header block renders nothing — indistinguishable from the feature never
having run, with no error surfaced anywhere. Separately, `connect()` has no
unregister/cleanup on unmount, so a page remount (SvelteKit navigation, HMR)
could re-run tool registration against the same `document.modelContext` with
no guaranteed dedupe.

## Acceptance criteria

- A `connectWebmcp` rejection is caught and results in a visible error/degraded
  status in the header (e.g. "WebMCP failed to connect"), not a silently blank
  header.
- Revisit whether `connect()` needs unregister-on-unmount or idempotent
  re-registration handling for the remount case; either fix it or document why
  it's not currently reachable in this app's routing.
