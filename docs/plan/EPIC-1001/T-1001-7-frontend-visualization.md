# T-1001-7: Frontend visualization

**Epic**: EPIC-1001 (WebMCP Pattern Research Workbench)
**Status**: Done
**Depends on**: T-1001-6, T-1001-5
**Blocks**: —
**Issue**: #1

## Description

The core "wow" of this project is visual — a human seeing many aligned
historical chart instances at once, zooming into one, seeing outcome
distributions, and watching a visible log of what the agent has been
doing. This ticket delivers those views on top of the shell (T-1001-6) and
real engine (T-1001-5) from prior tickets.

## User Story

As a user researching a pattern,
I want to see matching historical instances as aligned small charts, zoom
into any one of them, see how outcomes were distributed, and watch what
the agent has done,
so that I can visually evaluate a hypothesis alongside the agent's
analysis.

## Acceptance Criteria

1. A set of historical instances can be displayed as a grid of small
   charts, each aligned to its own anchor date, so patterns across
   instances are visually comparable.
2. A single instance from that grid can be selected to view in a larger,
   more detailed chart.
3. The distribution of a measured outcome across a result set can be
   viewed as a histogram.
4. Every tool call made by an agent during the session is visible to the
   human in a running log or feed, in the order it happened.
5. A change a human makes directly in the UI (e.g., selecting an instance)
   is reflected in what an agent sees when it reads the shared session
   state.

## Design References

- `docs/plan.md` — agent activity feed rationale, hand-rolled
  visualization decision
- `docs/design/pattern-research-workbench/spec.md` — "Grid visualization,"
  "Instance focus," and cross-actor visibility scenarios

## Solution Approach

Implements `spec.md`'s "Grid visualization" (incl. the partial-instance
display case), "Instance focus," and the activity-feed half of "Shared
workspace & collaboration." Small-multiples grid and focus chart render
from `InstanceWindow` data (T-1001-4) via hand-rolled canvas/SVG — no
charting library, per `docs/plan.md`. The activity feed is populated by
extending `register.ts`'s existing `execute()` wrapper (already the single
choke point every tool call passes through, per `docs/tools.md`) to append
an `AgentActivityEvent` before returning — this is additive to
already-built code, not a rewrite.

**Contracts introduced:** `AgentActivityEvent` →
`src/lib/workspace/activity.ts` — `id`, `toolName`, `timestamp`, `input`,
`summary`.

**Config vars introduced:** none.

## Out of Scope

Chart interactivity beyond selection/zoom (e.g., manual drawing tools) —
not needed for the demo.
