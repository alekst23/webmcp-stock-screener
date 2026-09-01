# T-1008-3: Instrument directory port and reference-data seam

**Epic**: EPIC-1008 (Discovery & Catalog)
**Design**: docs/design/discovery-and-catalog/
**Status**: Open
**Depends on**: T-1008-1
**Blocks**: T-1008-4

## Description

Resolving "Apple" or "AAPL" to a canonical instrument needs reference data
— exchanges, listings, asset types, countries, currencies — that this
project does not yet have a source for. No workstream owns it; sourcing it
is an open decision (see the project plan's Blockers). This ticket delivers
the boundary anyway: a domain port stating exactly what the program needs,
and a default adapter that reports the data as unavailable so every
downstream tool works, honestly, before any real source lands. This is the
**integration seam** for the whole program, so the contract and its
documentation are the deliverable, not a data source.

## User Story

As whoever eventually sources reference data,
I want one documented port with a fixed request and response shape and a
worked description of what each field means,
so that I can implement against it independently and know my adapter will
drop into the discovery tools without either side changing.

## Acceptance Criteria

1. A port declares two operations: search for instruments matching free
   text, and fetch one instrument by its canonical ID. Both are
   asynchronous and both return the discovery result envelope from T-1008-1.
2. An instrument record states a canonical instrument ID, the display
   symbol, the instrument name, the exchange (both an internal exchange ID
   and its MIC), the asset type, the country, the trading currency, whether
   it is the primary listing, and its listing status.
3. The canonical instrument ID is distinct from the display symbol, and no
   part of the port's contract permits a bare ticker to be used as an
   identifier.
4. A search request accepts free text plus optional narrowing by asset type,
   exchange, and country, an option to include delisted instruments, and a
   result limit; the limit is bounded so an unbounded search is not
   expressible.
5. A search result item states its match score and which attribute matched
   (symbol, name, alias, or a security identifier), so the caller can
   explain an ambiguous resolution rather than silently taking the top hit.
6. Fetching an unknown instrument ID resolves to an explicit not-found
   outcome rather than throwing or returning a fabricated record.
7. A default adapter, used when no reference-data source is configured,
   returns a well-formed empty result whose provenance marks the source as
   unconfigured and whose warnings state that no reference-data source is
   configured. It never throws and never returns invented instruments.
8. Which adapter is in use is decided at composition time by the caller, not
   by a module-level global, so a real adapter can replace the default
   without editing consuming code.
9. The port, its record shapes, and the expectations placed on an
   implementer are documented in the feature's technical design as the
   program-to-workstream contract, including how the implementer is expected
   to populate every provenance field.
10. A test double implementing the port with configurable results is
    available for other tickets' tests, and the port's own tests cover: a
    matching search, a no-match search, a not-found fetch, and the default
    adapter's unavailable-but-well-formed behavior.

## Design References

- `docs/reference/tool-spec.md` — `search_instruments`' purpose ("resolve
  ticker/company text to canonical instrument IDs, exchanges, and asset
  types") and the stable-ID rule.
- `docs/design/discovery-and-catalog/technical.md` — the port contract and
  the implementer's checklist.
- `backend/domain/contracts/engine.py` — the existing Protocol-as-port
  convention in this repo (contract in domain, adapter in infra, docstring
  stating what raises when).
- `backend/domain/models/universe.py` and
  `docs/reference/data-provider.md` — the existing precedent that
  classification metadata is sourced separately from the OHLCV pipeline,
  which is the same split this port formalizes.

## Technical Considerations

- New files only.
- Domain never imports from infra: the port and record types must not import
  the default adapter, HTTP clients, or anything with I/O.
- Do not build a mock or fixture instrument dataset. The default adapter's
  correct behavior is "no data, here is why", not "plausible-looking sample
  data". A configurable test double is fine — it lives with the tests, not
  in the shipped default path.
- A future adapter may implement this over HTTP against the existing
  FastAPI backend. Document the expected wire shape in `technical.md` so
  that choice does not require renegotiating the port.
- Ambiguity is the normal case for this tool ("Apple" matches several
  listings). The contract must make returning several ranked candidates the
  natural outcome, and picking one silently the awkward one.

## Out of Scope

- Implementing a real reference-data source, ingestion, or backfill.
- Sector, industry, index, fundamentals, and earnings-calendar data —
  T-1008-2 declares those as catalog fields; supplying them is the other
  workstream's job.
- The `search_instruments` tool itself (T-1008-4).
