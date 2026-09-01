# T-1017-9: Select and wire the engine at the composition root

**Epic**: EPIC-1017 (DuckDB Query Engine)
**Status**: Open
**Depends on**: T-1017-7, T-1017-8
**Blocks**: —
**Issue**: #15
**Design**: docs/design/duckdb-query-engine/

Resolves #15

## Description

Everything before this ticket is new code in new files, wired to nothing.
This ticket makes the DuckDB engine the one the application actually uses,
and does so in a way that can be reversed at runtime rather than by a
redeploy.

The startup path is what changes. Today the application reads the panel
object into memory and constructs the pandas engine from the resulting price
bars — the measured 217 MB -> 364 MB step this epic exists to avoid. On the
DuckDB path that step must not happen at all: the engine is constructed from
a storage handle and the panel is never resident.

Two behaviors are load-bearing and must survive: with no object-store
credentials the application still boots and serves the mock panel, and with
no panel anywhere it still starts and answers with a clear remediation
message rather than crashing.

Because this modifies existing startup behavior rather than adding isolated
new code, engine selection is feature-flagged, per the project's dead-code
policy.

## User Story

As the operator of the deployed backend,
I want to choose which query engine serves traffic, and to see which one is
serving,
so that switching to the new engine is a decision I can reverse in seconds if
it misbehaves.

## Acceptance Criteria

1. Which engine serves is selected by configuration at startup, defaults to
   the existing pandas engine, and switching requires no code change.
2. With the DuckDB engine selected, the panel is never materialised in the
   process at startup. Demonstrated by the absence of the load-path memory
   step in a measured startup, not by inspection.
3. With the pandas engine selected, startup, memory, and behavior are
   unchanged from today.
4. With no object-store credentials present, the application boots and
   serves the mock panel regardless of which engine is selected.
5. With no panel available anywhere, the application starts and the research
   routes answer with the existing clear remediation response rather than
   crashing at startup.
6. Which engine is serving, and the reason it was chosen, is observable at
   runtime through the application's own surface — not inferable only from
   reading configuration.
7. The panel status the application discloses — as-of date, coverage,
   staleness — is the same on both engines.
8. If the DuckDB engine fails to initialise, the failure names what is
   missing. Whether it falls back to the pandas engine or refuses to start
   is a stated decision, not an accident.
9. Every existing test passes unchanged with the default selection.
10. The full research flow — define studies, define a setup, find instances,
    measure, split, fetch windows — is exercised end to end through the API
    against the DuckDB engine.

## Design References

- `backend/main.py` — `_load_engine`, `_panel_store`, and the lifespan hook;
  this is the composition root being changed.
- `backend/application/load_panel.py` — the current load path, its
  mock-panel fallback, and the documented reason that fallback is not a
  transitional shim.
- `backend/api/routes/research.py` — the dependency that answers 503 when no
  engine is loaded (AC5).
- `backend/.env.example` and `render.yaml` — where a new configuration
  variable is documented and where deployed secrets are declared
  `sync: false`.
- `docs/design/duckdb-query-engine/technical.md`.

## Technical Considerations

- The two engines construct differently — one from price bars, one from a
  storage handle — so selection has to happen before loading, not after. A
  naive flag checked after `load_panel` would pay the load cost regardless
  and quietly defeat AC2.
- Dependencies are passed explicitly through the composition root; there is
  no container to register an implementation with.
- The flag exists so the switch is reversible under load, not because the
  work is unfinished. Once the DuckDB engine has run in production long
  enough to be trusted, removing the flag and the pandas path is a separate
  decision that needs T-1017-8's deployed figures first.

## Out of Scope

Removing `PandasPatternResearchEngine` — it remains the reference
implementation T-1017-7 compares against. Changing the API surface or any
route's response shape. The deployed-instance measurements, which remain
T-1016-6's outstanding acceptance criteria.
