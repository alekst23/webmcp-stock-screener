# Results & Explain — Product Spec

## Intent

A screener's output is only useful if the person and the agent looking at
it can both *read* it and *trust* it. Today a screener run ends at a
pinned `run_id` and a count — there is no way to shape how results are
presented, to page through them without paying to re-run, to push a
selection into a chart, or to ask why a particular instrument passed or
failed.

This feature delivers the Results area of the WebMCP tool surface: a
configurable results table, bounded paging over an already-pinned run,
selection that propagates to linked panels, and a per-instrument
explanation that makes the screener's verdict fully auditable — the
actual value and pass/fail state for **every** filter, plus how much each
ranking field contributed to the instrument's score.

Done looks like: an agent configures the table, pages through a run's
results without ever silently re-running it, selects an instrument, and
answers "why is this one here, and why isn't that one?" from data the
tools return — with every number carrying its own provenance.

## Preconditions

- A workspace exists with a revision, and mutations carry the common
  contract (`expected_revision`, `idempotency_key`, mutation envelope,
  undo tokens) — owned by EPIC-1006.
- A screener exists and has produced at least one pinned `run_id` —
  owned by EPIC-1009.
- A panel container and panel-kind registry exist, into which the
  `results_table` panel kind plugs — owned by EPIC-1007.
- Reference and fundamental market data is reachable through the domain
  ports EPIC-1008 defines.

## Features

1. **Configure the results table**: set displayed columns, computed
   columns, sort order, grouping, conditional formatting, page size, and
   which chart panel the table is bound to.
2. **Read a bounded page of results**: retrieve a page of an existing
   run's results, by `run_id`, without ever re-running the screener.
3. **Select results**: mark one or more results as selected so linked
   chart and details panels follow the selection.
4. **Explain a result**: for one instrument in a run, return the actual
   value and pass/fail state for every filter in the screener's filter
   tree, plus each ranking field's contribution to the final score.

## Behavioral Specifications

### Configure the results table

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a `results_table` panel | the agent sets columns, sort, grouping, formatting rules, page size, and a linked chart panel | the panel's configuration is updated and a mutation envelope is returned with the new revision and a diff summary |
| Unknown field | a column referencing a field that is not in the catalog | the agent applies the configuration | the mutation is rejected naming the offending field; no partial configuration is applied |
| Computed column | a computed column defined over permitted fields | the agent applies it | the column appears in results with its unit and formatting, and is available as a sort and grouping key |
| Invalid computed column | a computed column whose expression is malformed or references a disallowed field | the agent applies it | the mutation is rejected with the parse error and the list of permitted fields, so the agent can self-correct in one turn |
| Sort on a hidden column | a sort key that is not among the displayed columns | the agent applies it | the configuration is accepted and a warning states the sort key is not visible |
| Stale revision | the workspace has advanced past the caller's `expected_revision` | the agent applies a configuration | the mutation is rejected as a revision conflict; nothing is changed |
| Replay | the same `idempotency_key` is submitted twice | the agent re-sends the mutation | the original result is returned and the workspace is changed exactly once |
| Page size over the maximum | a requested page size above the hard bound | the agent applies it | the mutation is rejected naming the maximum, rather than silently clamping |

### Read a bounded page of results

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a pinned `run_id` | the agent requests a page | at most one bounded page of rows is returned, projected through the table's configured columns and ordered by its configured sort, together with the total result count and a cursor for the next page |
| No silent rerun | a pinned `run_id` | the agent requests any page | the screener is not executed again; the rows returned are those of the pinned run, and the returned `as_of` is the run's own timestamp, not the time of the read |
| Expired or unknown run | a `run_id` that no longer exists or was never produced | the agent requests a page | an explicit error names the `run_id` and directs the caller to run the screener again; no run is executed as a side effect |
| Stable ordering | a run whose configured sort has ties | the agent pages through the whole result set | every row appears exactly once across pages, with a deterministic tie-break |
| Provenance | any returned page | the agent reads it | every page states `as_of`, source, live/delayed status, timezone, currency, price adjustment policy, fundamentals reporting period, and the calculation-engine version |
| Bounded by construction | a request with no page size, or with one over the maximum | the agent requests a page | the default page size applies when none is given; a request over the maximum is rejected naming the maximum |
| Empty run | a run that matched nothing | the agent requests a page | an empty page with a zero total is returned, not an error |

### Select results

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a run's results and one or more result IDs | the agent selects them | the panel's selection is updated and a mutation envelope is returned |
| Propagation | the results panel is linked to a chart and a details panel | the agent selects a single result | the linked chart and details panels show that instrument |
| Multi-select with a single-symbol target | several results are selected and a chart panel is linked | the selection propagates | the chart follows the primary (first) selection and a warning states that the remaining selections were not propagated |
| Not in the run | a result ID that is not part of that run | the agent selects it | the mutation is rejected naming the unknown ID; the previous selection is unchanged |
| Clearing | an existing selection | the agent selects an empty set | the selection is cleared and linked panels stop following it |
| Human selection visible | the person has selected rows directly in the UI | the agent reads the panel | the current selection is visible to the agent, and agent selection replaces it explicitly rather than merging silently |

### Explain a result

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Happy path | a pinned `run_id` and an instrument ID | the agent asks for an explanation | every filter condition in the screener's filter tree is returned with its operator, its threshold, the instrument's actual value, and its pass/fail state — including conditions nested inside `AND`/`OR`/`NOT` groups, with each group's own resolved outcome |
| Ranking contribution | the screener defines ranking fields and weights | the agent asks for an explanation | each ranking field's raw value, normalized value, weight, and contribution to the final score is returned, along with the instrument's rank in the run |
| Failed candidate | an instrument that was evaluated but did not pass | the agent asks for an explanation | the explanation is returned with the failing conditions identified, and states that the instrument is not among the run's results |
| Not evaluated | an instrument outside the run's universe | the agent asks for an explanation | an explicit error states the instrument was not part of that run's universe, rather than returning an empty or fabricated explanation |
| Unavailable data | a filter whose input datum was missing for that instrument | the agent asks for an explanation | that condition is reported as indeterminate with the reason, distinct from a genuine fail |
| Provenance | any explanation | the agent reads it | every value carries the same provenance the results page carries, and the explanation names the pinned `run_id` it was derived from |
| No silent rerun | a pinned `run_id` | the agent asks for an explanation | the screener is not executed again; the explanation is derived from the pinned run |

## Cross-cutting Rules

- Every resource is addressed by a stable ID — panel IDs, screener IDs,
  run IDs, result IDs, instrument IDs. A bare ticker is never an
  identifier; it is a display attribute of an instrument.
- Every mutation accepts `expected_revision` and `idempotency_key` and
  returns `{change_id, new_revision, affected_ids, diff_summary,
  warnings, undo_token}`.
- Every market-data value returned states `as_of`, source, live/delayed
  status, timezone, currency, adjusted/unadjusted prices, fundamentals
  reporting period, and calculation-engine version.
- Reads never mutate. In particular, reading results or an explanation
  never executes a screener.

## Non-Goals

- Creating, editing, validating, or running screeners — EPIC-1009.
- Establishing the links between panels (`link_panels`), the panel
  container, and the panel-kind registry itself — EPIC-1007.
- The workspace/revision model, mutation envelope, and undo mechanics —
  EPIC-1006.
- Catalog and instrument discovery — EPIC-1008.
- Exporting results, saving results to a watchlist, backtesting, and
  alerting — later epics.
- Retiring the existing 11-tool pattern-research surface — EPIC-1015.

## Open Questions

1. **Where the results-table configuration lives.** Assumed to be
   workspace state scoped to the `results_table` panel, carried by
   EPIC-1006's revision model — not a property of the screener or of a
   run. Revisit if EPIC-1006 places panel configuration elsewhere.
2. **Run retention.** The design doc does not say how long a pinned run's
   results remain readable. Assumed: a run can expire, and an expired
   `run_id` produces an explicit error naming the run — never an implicit
   re-run.
3. **Where computed columns and sort are evaluated.** Assumed: across the
   full result set of the pinned run before paging, so paging is stable
   and sorting is correct — not per-page.
4. **Page size bounds.** The design doc says "bounded" without a number.
   Assumed: default 25 rows, hard maximum 200, with the total count and a
   next-page cursor always returned.
5. **Scope of `explain_result`.** The tool is named for a *result*, but
   pass/fail state is only meaningful if failures can be explained too.
   Assumed: it explains any instrument the run evaluated — passing or
   failing — and says which of the two it was.
6. **Who computes ranking contributions.** Assumed: EPIC-1009's ranking
   engine emits per-field contributions as part of the run, and this
   feature surfaces them. If EPIC-1009 does not, this feature defines the
   contribution contract and EPIC-1009 fills it.

---

*Implemented by: EPIC-1010*
