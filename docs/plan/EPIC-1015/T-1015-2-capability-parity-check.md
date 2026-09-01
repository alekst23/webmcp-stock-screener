# T-1015-2: Capability-parity check (deletion gate)

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Status**: Open
**Depends on**: T-1015-1
**Blocks**: T-1015-3, T-1015-4

## Description

The main risk this epic exists to prevent is a capability that quietly
disappears in the cutover — something the legacy surface could do that
nobody notices is gone until after the old code is deleted. This ticket
is the gate: every legacy capability is mapped to a named new-surface
equivalent, or is recorded as a deliberate drop the user has seen.

The deliverable is a parity matrix plus a go/no-go verdict. It is the
last point in the epic where the answer can still be "stop, the new
surface isn't ready".

## User Story

As the user who approved the cutover,
I want proof that nothing I could do before has silently become
impossible,
so that approving deletion is an informed decision rather than a leap.

## Acceptance Criteria

1. Every behavioral capability of the legacy surface is enumerated,
   derived from its behavioral spec and its tool surface rather than
   from memory.
2. Each capability is mapped to either a named tool or flow in the new
   surface, or an explicit "dropped" verdict.
3. Each mapping is verified against code that actually exists on the
   branch — a tool named in a design doc but never implemented counts
   as a drop, not a match.
4. Each mapping records whether it is an exact match, a partial match
   (the capability survives in reduced form, with the reduction stated),
   or a drop.
5. Every drop and every partial match is listed together in one section
   the user can read and sign off on, without reading the whole matrix.
6. The ticket produces an explicit go/no-go verdict on proceeding to
   deletion, and states what would have to change to turn a no-go
   into a go.
7. No legacy file is deleted or modified in this ticket.
8. The parity matrix is committed to the epic branch.

## Design References

- `docs/design/pattern-research-workbench/spec.md` — the Behavioral
  Specifications section (study definition, temporal setup definition,
  instance search, instance sampling, outcome measurement, instance
  splitting, grid visualization, instance focus, shared workspace and
  collaboration, progressive tool availability) is the authoritative
  capability list for the legacy surface.
- `docs/design/workspace-snapshots/spec.md` — snapshot save/recall/delete
  and the unsaved-changes guard are legacy capabilities too, and are
  easy to forget because they came from a different epic.
- `docs/tools.md` — the per-tool "Available when" column captures the
  progressive-availability behavior, which is itself a capability.
- The design docs of EPIC-1006 through EPIC-1014 — the new-surface side
  of the mapping.
- `.dev/design/tool-spec.md` — states intent, not what shipped. Use it to
  find the intended equivalent, then verify against code.

## Technical Considerations

Three capabilities are known in advance to be the hard cases, and were
recorded as Open Questions on the epic. This ticket is where they get
answered:

- **Temporal setup definition and instance search.** The legacy surface
  matches sequences of conditions with `within`/`sustained` windows over
  `(ticker, date)` events. The new surface's nearest analogue is
  `edit_filter_tree`'s Temporal and Pattern condition types combined with
  `run_screener`. Confirm whether multi-step sequences with inter-step
  windows actually survive, or only single temporal predicates — the
  difference is a partial match, and it should be named as one.
- **Outcome measurement and instance splitting.** `measure` (metric across
  a set plus universe base-rate comparison) and `splitInstances`
  (winners/losers, or by condition) have no core-tool counterpart;
  `backtest_screener` / `get_backtest_results` are follow-up tools in the
  target spec. If those did not ship, this is a real drop and needs
  explicit user sign-off before T-1015-5 removes the tools.
- **Progressive tool availability.** The legacy surface registers tools as
  the workflow unlocks them, and this was a deliberate demonstration of
  the WebMCP `toolchange` story. Confirm whether the new surface still
  does this; the transport that implements it is being kept, so a drop
  here would be a product decision rather than a technical loss.

Also check the non-tool capabilities, which are easy to miss because no
tool name points at them: human-side grid selection, single-panel close,
the activity/action log with its human-vs-agent attribution, the manual
tool harness route, and the workspace-status header.

## Out of Scope

Building anything to close a parity gap — if a gap is a no-go, it goes
back to the epic that owns that capability. Deleting anything.
