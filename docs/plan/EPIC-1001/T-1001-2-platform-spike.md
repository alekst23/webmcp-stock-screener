# T-1001-2: Platform spike

**Epic**: EPIC-1001 (WebMCP Pattern Research Workbench)
**Status**: Open
**Depends on**: T-1001-1
**Blocks**: T-1001-5
**Issue**: #1

## Description

The entire project's premise depends on a real AI agent being able to
discover and call a WebMCP tool running in an actual browser, where that
tool's execution reaches a live backend over the network. This has not
been verified end-to-end on the actual target platform(s). This ticket
proves that path works before further investment, using the mock dataset
so no paid data is required.

## User Story

As the project owner,
I want confirmation that an AI agent can call one of our WebMCP tools in a
real browser and get back a real answer from a live backend,
so that I know the fundamental approach is viable before building the rest
of the system on top of it.

## Acceptance Criteria

1. At least one WebMCP tool is registered on a page and is discoverable by
   a real AI agent running in a browser environment that supports WebMCP
   (e.g., Chrome with the feature enabled, or another WebMCP-capable
   in-app browser).
2. The agent can successfully invoke the tool with valid arguments and
   receive a structured result.
3. The tool's execution makes a real network request to a live backend
   service (not a hardcoded or purely local response) and returns data
   sourced from that backend's mock dataset.
4. The backend serving the request is running on the hosting platform
   intended for the project, not only on a local development machine.
5. The full round trip — agent invokes tool, network request fires,
   backend responds, result reaches the agent — is demonstrated and its
   outcome recorded, including any platform-specific quirks or limitations
   discovered along the way.

## Design References

- `docs/reference/webmcp-guide.md` — WebMCP API surface, browser support status,
  known limitations
- `docs/plan.md` — why this is the top risk in the project

## Solution Approach

Deliberately throwaway proof-of-concept, superseded by T-1001-5. A minimal
FastAPI endpoint (`GET /api/spike/ping`) reads a couple of rows directly
from T-1001-1's mock Parquet panel and returns them — no read abstraction
here; a proper panel-reading contract belongs to T-1001-3. On the
frontend, a temporary tool (not one of the 9 product tools — reusing e.g.
`sampleInstances` wouldn't work cleanly since it requires an instance set
that doesn't exist until T-1001-3/4 exist) is registered whose `execute()`
calls that endpoint. Backend deployed to Render; a real agent on the
target WebMCP platform invokes the tool to prove the full round trip.

**Contracts introduced:** `SpikePingResponse`
(`backend/api/schemas/spike.py`) — API-layer DTO (not a domain model):
`message: str`, `sample: PriceBar`.

**Config vars introduced:** none.

## Technical Considerations

This may require a browser flag or a signup-gated preview program. The
browser/device configuration confirmed working here should be the one used
for the actual submission demo.

## Out of Scope

The full 9-tool surface — one tool is enough to prove the mechanism.
