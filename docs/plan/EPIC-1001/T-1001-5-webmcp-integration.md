# T-1001-5: WebMCP integration

**Epic**: EPIC-1001 (WebMCP Pattern Research Workbench)
**Status**: Open
**Depends on**: T-1001-2, T-1001-4
**Blocks**: T-1001-7
**Issue**: #1

## Description

The project already has a typed WebMCP tool surface (9 tools) with tests,
built against a placeholder implementation. This ticket connects that
surface to the real, mock-data-backed engine so an actual agent call
produces a real answer, and confirms the tool-availability behavior (tools
appearing and disappearing as the research workflow progresses) still
holds against the real implementation, not just the placeholder.

## User Story

As an AI agent using this app's WebMCP tools,
I want each tool call to be answered by the real engine rather than a
placeholder,
so that my actions actually affect and reflect the shared research
session.

## Acceptance Criteria

1. Every one of the 9 existing WebMCP tools is backed by the real,
   mock-data-backed engine rather than the placeholder implementation used
   during initial development.
2. Tools that require a prior step's output (e.g., a tool that needs a
   search result to exist first) remain unavailable to the agent until
   that prerequisite exists, and become available immediately after — this
   holds true against the real implementation, not just the placeholder.
3. An invalid expression submitted through a tool call returns the same
   self-correcting error behavior (listing what's supported) already
   verified against the placeholder.
4. A full example research session — defining a series, defining a
   pattern, searching, sampling, measuring, and viewing a grid — can be
   carried out entirely through tool calls, end to end, with no manual
   backend intervention.
5. The existing automated tests for tool availability and error handling
   continue to pass against the real implementation.

## Design References

- `docs/tools.md` — full tool surface and design rules
- `docs/plan.md` — client/server split rationale

## Technical Considerations

This is the point where the platform spike (T-1001-2) and the engine
(T-1001-4) converge — do not start until both are complete.

## Out of Scope

Building new tools or changing the shape of the tool surface.
