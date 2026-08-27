# T-1001-6: Frontend shell

**Epic**: EPIC-1001 (WebMCP Pattern Research Workbench)
**Status**: Open
**Depends on**: —
**Blocks**: T-1001-7
**Issue**: #1

## Description

The app needs a place for a human to see and interact with the same
research session an agent manipulates through WebMCP tools — shared
workspace state (defined series, patterns, result sets, panels, and
current selection/focus) needs to live somewhere visible and persist
across a session. It also needs a way to exercise the tool surface
manually during development, before a real WebMCP-capable browser is
available for testing.

## User Story

As a developer,
I want an app shell that holds and displays the shared research session
state and lets me trigger tool actions manually,
so that I can build and verify the rest of the system without depending on
a WebMCP-capable browser being available at all times.

## Acceptance Criteria

1. The app displays the current state of the shared research session —
   defined series, defined patterns, result sets, open panels, and the
   current focus/selection — in a way a human can read at a glance.
2. Session state persists across a page reload within the same browser.
3. A development-only control surface lets a person manually trigger any
   of the tool actions with arbitrary input and see the result, without
   needing an AI agent or a WebMCP-capable browser.
4. Changes made through the manual control surface are reflected in the
   same session-state view an agent would see if it queried the session.

## Design References

- `docs/plan.md` — client-side workspace state design, anonymous/no-auth
  session decision
- `docs/design/pattern-research-workbench/spec.md` — "Shared workspace &
  collaboration" scenarios (happy path, persistence, cross-actor visibility)

## Solution Approach

Implements `spec.md`'s "Shared workspace & collaboration" scenarios: a
Svelte store holding `WorkspaceState` (already defined in
`src/lib/webmcp/types.ts` — no new shape needed), a persistence layer that
serializes it to `localStorage` on every mutation and rehydrates on load,
and a dev-only panel (route-gated or env-gated, not shipped in the
production build's primary UI) that lets a developer call any tool
function directly and see the resulting state change — this is what makes
the rest of the epic buildable without depending on Chrome Canary access
day to day.

**Contracts introduced:** none new — reuses `WorkspaceState` from
`types.ts` directly as both the in-memory store shape and the persisted
JSON shape.

**Config vars introduced:** none.

## Out of Scope

The actual chart/grid visualizations (T-1001-7) — this ticket is the shell
and state layer, not the rendering.
