# T-1014-10: Export a pinned run with provenance

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Open
**Depends on**: — (consumes EPIC-1010's pinned runs)
**Blocks**: T-1014-11
**Issue**: —

## Description

Deliver `export_results`: emit a pinned run's rows together with
everything needed to understand and reproduce them — the filter tree and
ranking that produced them, the universe, the run ID and timestamp, and
the full market-data provenance envelope.

An export without provenance is a screenshot with extra steps. The point
of this tool is that six months later someone can look at the file and
say exactly which screener revision, which run, which data source, and
which price-adjustment policy produced those rows.

## User Story

As a researcher taking work out of the app,
I want the export to carry the filters, the run, the timestamp, and the
data provenance with it,
so that the numbers stay interpretable — and reproducible — once they are
outside the workspace that made them.

## Acceptance Criteria

1. `export_results` accepts a pinned run ID and returns an export
   containing the run's result rows, the filter tree and ranking that
   produced them, the universe, the run ID, and the run timestamp.
2. The export states the full market-data provenance: `as_of`, source,
   live/delayed status, timezone, currency, price adjustment policy,
   fundamentals reporting period where fundamentals were included, and
   calculation-engine version.
3. The export identifies the exact screener revision the run executed, so
   it can be traced back to a reproducible definition.
4. Exporting never re-executes the screener. The exported rows match the
   pinned run exactly.
5. Exporting an unknown or expired run ID is rejected saying so; no run
   is executed to cover for the missing result.
6. A subset of columns can be selected for export, including computed
   fields; only those columns are exported and the provenance is
   unchanged.
7. For a large result set the export is bounded or paginated, and states
   plainly that it is a bounded subset, how many rows the run held, and
   how the exported rows were selected.
8. The export has a stable export ID, and the exported payload's
   structure is self-describing enough to be read without the app.
9. `export_results` writes nothing to disk and calls no external service;
   it returns a payload the app offers to the researcher as a download.
10. Exporting is read-only with respect to workspace state — it creates
    no revision-affecting mutation and requires no undo.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Export results"
  scenario table.
- `.dev/design/tool-spec.md` — `export_results` ("export the pinned run,
  filters, timestamp, and provenance"); the market-data provenance
  requirement listing every field an export must state.
- `docs/plan/EPIC-1010/_epic.md` — pinned `run_id` semantics, the
  no-silent-rerun guarantee, results-table column configuration, and the
  bounded-read conventions this follows.
- `docs/plan/EPIC-1009/_epic.md` — the screener revision, filter tree,
  ranking, and universe an export must describe.

## Technical Considerations

- The export destination is a working assumption recorded in the epic's
  Open Questions: a returned payload plus an app-offered download, with
  no filesystem or network side effect from the tool itself.
- If more than one export format is offered, the provenance must be
  present in all of them — a flat tabular format needs the provenance
  carried in a way a spreadsheet does not silently drop.
- Expired runs are the interesting failure case. Failing honestly is
  correct; re-running to produce "equivalent" rows would break the
  export's whole reason to exist.

## Out of Scope

- Uploading, emailing, or otherwise transmitting an export anywhere.
- Scheduled or recurring exports.
- Importing an export back into the app.
- Exporting backtest results, watchlists, or chart images — this ticket
  exports screener runs.
