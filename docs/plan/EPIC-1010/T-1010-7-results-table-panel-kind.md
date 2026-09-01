# T-1010-7: `results_table` panel kind with selection and explain view

**Epic**: EPIC-1010 (Results & Explain)
**Design**: docs/design/results-and-explain/spec.md
**Status**: Open
**Depends on**: T-1010-4, T-1010-5, T-1010-6
**Blocks**: T-1010-8

## Description

The human-visible half of the Results area: a `results_table` panel kind
registered with EPIC-1007's panel registry that renders a run's paged
results with the configured columns, grouping, and conditional formatting,
lets the person select rows, and surfaces the per-instrument explanation.
Whatever the agent does through the tools, the person sees here.

## User Story

As a researcher sitting next to the agent,
I want to see the results table it configured, click through it myself,
and open the explanation for any row,
so that I can follow and check the agent's work instead of taking its
word for the outcome.

## Acceptance Criteria

1. A `results_table` panel kind is registered with the panel registry and
   can be added to a workspace as a panel.
2. The panel renders the current page of its bound run's results using the
   configured columns and their labels and units, in the configured sort
   order.
3. Grouping, when configured, is rendered as visible groups.
4. Conditional formatting rules are applied to the cells they target, and
   a rule that matches no rows leaves the table unchanged rather than
   erroring.
5. The panel provides paging controls that request the next and previous
   pages and never trigger a screener run; the total result count is
   visible.
6. Provenance for the displayed page — `as_of`, source, live/delayed
   status, timezone, currency, price adjustment policy, fundamentals
   reporting period, and calculation-engine version — is visible or
   reachable from the panel without leaving it.
7. The person can select one or more rows directly, and that selection is
   the same selection the agent reads and writes.
8. A selection made in the panel propagates to linked chart and details
   panels, the same way an agent-driven selection does.
9. Every visible row offers a way to open its explanation, which shows
   every filter condition with its threshold, the instrument's actual
   value, and its pass / fail / indeterminate outcome, laid out so the
   `AND`/`OR`/`NOT` grouping is legible, plus the ranking contribution
   breakdown.
10. A run that matched nothing renders an explicit empty state; an expired
    or unknown run renders an explicit message telling the person the
    screener needs to be run again, rather than an empty table.
11. A panel whose run is still loading, and one whose read failed, each
    render a distinguishable state rather than a blank panel.
12. The existing pattern-research UI and its panels are unchanged and
    continue to work.

## Design References

- `docs/design/results-and-explain/spec.md` — all four feature sections;
  the panel is where their outcomes become visible.
- `docs/plan/EPIC-1010/T-1010-4-paged-results-use-case.md` and
  `T-1010-5-explain-result-use-case.md` — the reads this panel performs.
- `docs/plan/EPIC-1010/T-1010-6-configure-and-select-mutations.md` — the
  selection mutation a human click goes through.
- `src/lib/workspace/GridPanel.svelte` and
  `src/lib/workspace/WorkspaceView.svelte` — existing panel rendering
  conventions to follow. Not modified by this epic.

## Technical Considerations

- The panel container and registry are EPIC-1007's; register into them
  rather than building panel chrome.
- A human click on a row must go through the same selection mutation the
  agent uses (T-1010-6), so the two never diverge — this is what makes AC7
  true rather than incidentally true.
- Keep the table virtualization-agnostic: the page is already bounded, so
  no windowing machinery is needed at this size.

## Out of Scope

- The panel container, panel chrome, and `link_panels` (EPIC-1007).
- WebMCP tool registration (T-1010-8).
- Any change to the existing pattern-research UI (EPIC-1015).
