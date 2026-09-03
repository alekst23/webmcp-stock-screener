# T-1015-2: Capability-parity check (deletion gate)

**Epic**: EPIC-1015 (Legacy Surface Cutover)
**Status**: Done — verdict is **NO-GO**; see
`docs/plan/EPIC-1015/capability-parity-matrix.md`. Per this epic's own gate,
T-1015-3/T-1015-4 must not start until the user has reviewed that verdict.
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
- `docs/reference/tool-spec.md` — states intent, not what shipped. Use it to
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

## Solution Approach

**Status**: implemented — see
`docs/plan/EPIC-1015/capability-parity-matrix.md` for the full deliverable.
Verdict at time of writing was **NO-GO**; this was superseded by an
explicit user decision on 2026-09-03 (recorded in `_epic.md`'s
Superseded note) that accepted most flagged drops and turned the rest into
new ticket scope (T-1015-9 through T-1015-12). This section records the
approach taken.

**Implements**: the "Capability-parity check" scenarios in spec.md (exact
match, partial match, deliberate drop, doc-only tool, no-go).

**Approach**: documentation deliverable, gated on T-1015-1's inventory; no
code touched. Enumerated every capability from
`docs/design/pattern-research-workbench/spec.md`'s Behavioral
Specifications plus the non-tool capabilities T-1015-1 flagged (workspace-
status header, human/agent-attributed action log, human-side grid
selection and panel close). Checked each against merged code, not design
intent, and extended the spec's "doc-only tool counts as a drop" rule to
code that exists but is unreachable: nine new-surface tool groups were
found real, tested, and merged but gated behind a build-time flag with no
external caller at the time of the check — recorded as "reachability
gaps," distinct from confirmed "structural gaps" that flag-flipping alone
cannot close (multi-step temporal sequencing, `measure`/`splitInstances`,
instance focus as a distinct concept, progressive tool availability, the
manual tool-harness route). All drops and partial matches were collected
into one sign-off section (AC5), and the ticket produced an explicit
go/no-go verdict plus what would change it (AC6). No file was deleted or
modified (AC7). The three hard cases named in advance in the epic's Open
Questions (temporal matching, measure/split, progressive availability)
were each resolved with a concrete, code-verified answer rather than left
as assumptions.

**Contracts to introduce**: none.

**Config vars introduced**: none — this ticket reads the state of
existing `*_TOOLS_ENABLED` flags, it does not define any.

**References**: `docs/plan/EPIC-1015/capability-parity-matrix.md` (the
deliverable), `docs/plan/EPIC-1015/retirement-inventory.md`,
`docs/design/pattern-research-workbench/spec.md`,
`docs/design/workspace-snapshots/spec.md`.

## Out of Scope

Building anything to close a parity gap — if a gap is a no-go, it goes
back to the epic that owns that capability. Deleting anything.
