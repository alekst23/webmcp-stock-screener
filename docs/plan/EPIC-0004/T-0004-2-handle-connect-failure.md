# T-0004-2: Handle WebMCP connect failure and remount in the status header

**Epic:** EPIC-0004
**Status:** Done

## Goal

Epic review of EPIC-0004 found (independently, by 3 of 5 review agents) that
`+page.svelte`'s `onMount` called `connectWebmcp(engine, activityStore)` with
no `.catch()`. `connect()` in `register.ts` awaits `engine.getWorkspace()` and
`mc.registerTool(...)`, either of which can reject in a genuine WebMCP-capable
browser (network error, malformed tool descriptor). Separately, `connect()`
had no unregister/cleanup on unmount, so a page remount (SvelteKit navigation,
HMR) re-ran tool registration against the same `document.modelContext` with no
guaranteed dedupe.

The review described the failure symptom as a header left blank on rejection,
which is no longer what happened by the time this ticket was picked up:
hotfix/webmcp-tools-always-visible had already made the header render its tool
count unconditionally, so the header stopped depending on `connectWebmcp`'s
outcome at all. That turned a silent-blank bug into a worse one — a header that
always claimed availability regardless of whether a bridge existed.

A real AI agent then visited the deployed site and hit exactly that. The page
told it "11 WebMCP tools available" and, in an HTML comment, "this page
registers 11 tools via document.modelContext". `document.modelContext` was
absent in that agent's browser, so nothing was callable. The agent had to
diagnose the contradiction itself and fall back to driving the UI by hand,
unaided — nothing on the page told it a UI fallback existed.

The fix therefore consumes `connectWebmcp`'s result for real: `null` →
`unavailable`, a connection → `connected`, a rejection → `failed`, and
`connecting` until it resolves. The header renames its always-visible count to
"defined", adds a live "available" count fed by registration changes, and
renders a bridge-state line beside them; the agent comment states plainly
whether the tools are callable in this session.

## Acceptance criteria

- A `connectWebmcp` rejection is caught and results in a visible error/degraded
  status in the header (e.g. "WebMCP failed to connect"), not a silently blank
  header.
- Revisit whether `connect()` needs unregister-on-unmount or idempotent
  re-registration handling for the remount case; either fix it or document why
  it's not currently reachable in this app's routing.

## Outcome

Both ACs are satisfied by hotfix/webmcp-bridge-status.

- AC1: the `failed` bridge state, rendered as its own header line and
  visually degraded, distinct from the unsupported-browser (`unavailable`)
  case.
- AC2: fixed rather than documented as unreachable — it is reachable today
  (`ssr` is off and `/` ↔ `/dev` is client-side navigation, which unmounts and
  remounts `+page.svelte`). `WebmcpConnection.dispose()` unregisters every tool
  the mount still owns, called from `onMount`'s returned cleanup. Two
  qualifications, both in `technical.md`: a bridge whose optional
  `unregisterTool` is absent cannot retire anything, and `dispose()` then
  reports nothing as torn down rather than claiming a teardown that did not
  happen; and a connection only unregisters names no newer mount has since
  claimed, so a late cleanup cannot wipe a live mount's registrations.
