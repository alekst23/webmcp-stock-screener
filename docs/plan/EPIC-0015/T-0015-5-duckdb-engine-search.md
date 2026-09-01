# T-0015-5: DuckDB engine — study/setup definition and instance search

**Epic**: EPIC-0015 (DuckDB Query Engine)
**Status**: Open
**Depends on**: T-0015-1, T-0015-3, T-0015-4
**Blocks**: T-0015-6
**Issue**: #15
**Design**: docs/design/duckdb-query-engine/

## Description

Assemble the session, the compiler, and the matcher into an adapter that
satisfies the first three methods of the `PatternResearchEngine` Protocol:
`define_study`, `define_setup`, `find_instances`. This is the ticket where
the second implementation becomes a real thing something can hold a reference
to.

The Protocol is the seam and it does not move. `backend/domain/` must be
unchanged when this ticket lands — if the port appears to need a wider
contract, that is a finding to report before writing code, not a change to
make. Structural subtyping means the adapter needs no import from the
Protocol beyond the domain types it already returns.

The universe filter is the part most likely to be quietly dropped:
`find_instances` narrows by `min_market_cap` and `sectors` using ticker
metadata that today lives in a Python dictionary beside the panel, not in the
Parquet. Pushing that filter into the query is what makes a narrow universe
actually cheaper; leaving it in Python makes it free of cost savings and
easy to forget.

## User Story

As the backend's composition root,
I want a query-engine implementation I can construct and hand to the existing
routes unchanged,
so that swapping the engine is a wiring decision rather than a rewrite.

## Acceptance Criteria

1. The adapter satisfies `define_study`, `define_setup`, and
   `find_instances` with the same signatures and return types as the
   existing engine, and a type check confirms it is accepted wherever the
   Protocol is required.
2. `backend/domain/` is unchanged by this ticket.
3. An unsupported expression raises the same domain error, carrying the same
   function catalog, at study definition and at setup definition — before
   any query runs.
4. `find_instances` returns an instance set whose identifiers, dates, ticker
   set, completeness values, ordering, complete count, partial count, and
   date bounds match the pandas engine's for the same panel and setup.
5. Narrowing by market capitalisation or sector reduces the bytes read from
   storage, not merely the rows returned. Demonstrated by measurement.
6. A narrowing that excludes every ticker returns an empty instance set
   without error.
7. Studies defined earlier in a session are referenceable by name from later
   studies and from setup steps, matching the existing engine's behavior.
8. The adapter constructs from a storage handle rather than from a list of
   price bars, and never materialises the whole panel in the process.
   Demonstrated by peak absolute process RSS during construction and search.
9. A storage or query failure surfaces as a domain error naming what failed,
   chained from the underlying cause.

## Design References

- `backend/domain/contracts/engine.py` — the seven-method Protocol; this
  ticket implements the first three.
- `backend/infra/pandas_engine.py` — the reference behaviors: `_new_id`'s
  identifier scheme, `_known_names`, `_filter_universe`, and
  `find_instances`' partial-fallback threshold.
- `backend/infra/nasdaq_screener.py` and `backend/domain/models/universe.py`
  — where the sector and market-cap metadata comes from and what shape it is
  in. AC5 depends on getting it somewhere the query can reach.
- `backend/application/load_panel.py` — the path AC8 is deliberately not
  taking. Its `parquet_bytes_to_bars` step is the measured 217 MB -> 364 MB
  jump the epic exists to avoid.
- `docs/design/duckdb-query-engine/technical.md`.

## Technical Considerations

- Ticker metadata reaching the query means either registering it as a
  queryable relation on the connection or reading the universe file
  alongside the panel. Either is fine; leaving it in a Python set and
  filtering results afterwards is not, because it defeats AC5.
- Identifier generation (`study_1`, `setup_2`, `set_3`) is per-engine-instance
  state in the current implementation. Two engines in one process would
  collide; that only matters for the differential harness (T-0015-7), which
  must not compare identifiers across engines.
- Structured logging at the storage boundary — operation, ticker count,
  bytes read, duration — is what makes AC5 and AC9 diagnosable in
  production rather than only in tests.

## Out of Scope

`sample_instances`, `measure`, `split_instances`, `get_instance_windows`
(T-0015-6). Selecting this engine at startup (T-0015-9) — until then it is
new code in new files, wired to nothing.
