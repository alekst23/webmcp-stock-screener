# T-1002-3: Timeline UI + remove raw state dump

**Epic**: EPIC-1002 (Unified Action Log)
**Design**: docs/design/pattern-research-workbench/
**Status**: Done
**Depends on**: T-1002-1
**Blocks**: —
**Issue**: #2

## Description

`ActivityFeed.svelte` currently renders a bare "Agent activity (N)"
heading and a flat, unstyled list. `WorkspaceView.svelte` separately
renders a redundant raw state snapshot (Studies/Setups/Instance sets/
Panels/Focus) with no relationship to the log. This ticket redesigns the
feed into an ordered, actor-labeled timeline and removes the raw snapshot
view — the log becomes the one place to see what happened in the session.

## User Story

As a human (or judge) watching a research session,
I want to see a clear, actor-labeled timeline of what happened,
so that I can tell at a glance who did what and when, without reading a
raw state dump.

## Acceptance Criteria

1. Each log entry visibly shows its actor as "Human" or "Agent" (per
   T-1002-1's `actor` field), the action, a human-readable summary, and a
   timestamp.
2. Entries render in true chronological order, interleaving human and
   agent actions correctly.
3. `WorkspaceView.svelte`'s raw Studies/Setups/Instance sets/Panels/Focus
   snapshot is removed from the page; no other panel/chart rendering is
   affected (grid/histogram/chart panels keep rendering exactly as they
   do today).
4. Resolves #2.

## Design References

- `docs/design/pattern-research-workbench/spec.md` — feature #9's revised
  description and behavioral rows
- `src/lib/workspace/ActivityFeed.svelte`, `src/lib/workspace/WorkspaceView.svelte`

## Solution Approach

Structural change only, no new contracts — `ActivityFeed.svelte` and
`+page.svelte` are edited. `WorkspaceView.svelte` itself is kept, not
deleted: `src/routes/dev/+page.svelte` also renders it, and the epic's
Out of Scope explicitly excludes any change to the `/dev` control
surface — deleting the file would break `/dev` to satisfy AC3, which
only requires removing the dump from the human-facing page.

- `ActivityFeed.svelte`: each `<li>` gains an actor badge, sourced from a
  small exported pure helper `actorLabel(actor: 'human' | 'agent'):
  'Human' | 'Agent'` in `activity.ts` (kept there alongside
  `summarizeToolCall` rather than inlined in the template, so the
  actor→label mapping is unit-testable without mounting the component —
  this codebase's established pattern, per `visualization.test.ts`
  testing `alignInstanceWindows`/`buildHistogram` rather than rendered
  markup) — rendered before the action/summary text (AC1). Heading
  changes from "Agent activity (N)" to
  "Activity log (N)" and the empty-state copy from "No tool calls yet."
  to "No activity yet." — both were agent-only phrasing that's now
  inaccurate (this feed already receives both actors once T-1002-1
  lands). Ordering needs no new logic: both the agent path
  (`register.ts`) and human path (`ChartToolbar.svelte`) append through
  `recordAction`'s `activity.update((events) => [...events, event])`, so
  array order already equals call order (AC2) — the component renders
  `events` as given, no client-side sort.
- `<WorkspaceView state={$workspaceStore} />`'s usage and import are
  removed from `src/routes/+page.svelte` only (AC3); `WorkspaceView.svelte`
  stays on disk for `/dev`. `workspaceStore`'s own import/usage in
  `+page.svelte` is untouched — `$workspaceStore.panels`, `.instanceSets`,
  and `.focus` still drive `GridPanel`/`HistogramPanel`/`FocusChart`
  rendering there, unaffected by removing the raw dump.
- No change to `store.ts`, `activity.ts`, `register.ts`, or
  `ChartToolbar.svelte` — those are T-1002-1/T-1002-2's surface.

**References:** `src/lib/workspace/ActivityFeed.svelte`,
`src/lib/workspace/WorkspaceView.svelte` (usage removed from `+page.svelte`
only, file kept for `/dev`), `src/routes/+page.svelte`.

## Out of Scope

Chart panel action-button redesign (tracked separately under #3 /
EPIC-1003). A full visual design system — this is a structural fix to the
log's presentation, not a styling overhaul.
