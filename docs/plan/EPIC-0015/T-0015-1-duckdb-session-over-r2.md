# T-0015-1: DuckDB session over R2 Parquet — credentials, pushdown, caching

**Epic**: EPIC-0015 (DuckDB Query Engine)
**Status**: Open
**Depends on**: — (blocked in practice on T-1016-3 landing on `main`)
**Blocks**: T-0015-5
**Issue**: #15
**Design**: docs/design/duckdb-query-engine/

## Description

Give the engine a SQL session that reads the panel where it already lives —
Cloudflare R2 — instead of pulling the whole Parquet file into the process
first. Today's startup path reads the object into a Python `bytes` (217 MB
absolute RSS on the 2.52M-row panel) and then parses it (364 MB). Neither
step should exist on the DuckDB path: the point of rung 2 is that the panel
is *queried*, not *loaded*.

This ticket delivers only the session and the read: connect, authenticate
against the existing R2 credentials, scan the partitioned panel, and prove
that a filtered query touches less of the file than an unfiltered one. No
expression compilation and no pattern matching.

## User Story

As the backend serving a filtered universe,
I want to query the stored panel in place, reading only the tickers, dates,
and columns a question actually needs,
so that a search's cost is set by the question rather than by the panel's
size.

## Acceptance Criteria

1. A query over the stored panel succeeds using only the object-store
   credentials the application already reads from its environment. No new
   credential, and no credential value, appears in any committed file.
2. Querying a named subset of tickers reads materially fewer bytes from the
   remote object than querying the whole panel, demonstrated by measured
   bytes or row-groups read rather than by inspection. The measured figure is
   compared against the equivalent figure T-1016-3 recorded for the same
   read, and any divergence is explained.
3. Querying a named subset of columns does not read the unnamed ones.
4. Restricting a query by date range prunes work beyond what the ticker
   filter alone prunes, or the ticket records that it does not and why —
   the panel is sorted by ticker, so date locality is not guaranteed.
5. A query for a ticker absent from the panel returns an empty result
   without error and without reading unrelated partitions.
6. Peak absolute process RSS while executing a whole-panel scan is measured
   and recorded, and stays materially below the cost of loading the same
   panel into the process.
7. Repeating an identical query does not re-fetch bytes already fetched
   within the same session; the caching behavior in force — what is cached,
   where it lives, and what evicts it — is recorded rather than left to
   whatever the defaults happen to be.
8. When the object store is unreachable or unconfigured, the failure is a
   domain-level error naming what is missing, not a raw client exception
   crossing the infra boundary.

## Design References

- `docs/plan/EPIC-1016/T-1016-3-ticker-partitioned-parquet.md` (on
  `epic/EPIC-1016-market-data-storage`) — the layout being read: sorted by
  ticker, 25,000-row row groups, with measured pruning fractions to compare
  against. Its "where pruning does not help" section is the AC2 baseline:
  pruning is a function of ticker *adjacency*, not ticker count, and a thin
  sample scattered across the alphabet reads nearly everything.
- `backend/infra/object_store.py` — the four environment variables and the
  `None`-means-not-configured convention that AC1 and AC8 must preserve.
- `backend/application/load_panel.py` — the current load path and its
  documented reason for falling back to the mock panel rather than failing.
- `docs/design/duckdb-query-engine/technical.md`.

## Technical Considerations

- R2 speaks the S3 API through a custom endpoint with region `auto`, for the
  same SigV4-scope reason `object_store.py` documents.
- The instance's writable disk is the constraint nobody has checked. If
  DuckDB is configured to spill, it needs somewhere to spill to, and the
  target Render instance's ephemeral filesystem may or may not have the
  space. An explicit memory limit plus a verified spill location is part of
  this ticket, not a later surprise. See the epic's open questions.
- Network round-trips are the latency risk that memory savings can hide.
  Record query latency alongside bytes read so a later regression has both.

## Out of Scope

Expression compilation (T-0015-2), pattern matching (T-0015-4), and any
change to how the panel is *written* — this ticket reads T-1016-3's layout
as it stands.
