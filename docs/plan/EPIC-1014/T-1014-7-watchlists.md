# T-1014-7: Watchlists

**Epic**: EPIC-1014 (High-Value Follow-Up Tools)
**Design**: docs/design/screener-followup-tools/spec.md
**Status**: Open
**Depends on**: — (consumes EPIC-1007's `watchlist` panel kind and
EPIC-1010's pinned runs)
**Blocks**: T-1014-11
**Issue**: —

## Description

Deliver `upsert_watchlist` and `save_results_to_watchlist` — the way a
result set stops being ephemeral. A watchlist is either static (a fixed
set of instruments) or dynamic (defined by a screener revision, so its
membership follows the screen). Saving a pinned run into one carries the
run's ID and timestamp along as provenance, so a researcher can later ask
where a name on the list came from.

Watchlists bind to EPIC-1007's `watchlist` panel kind, which is how the
researcher sees them.

## User Story

As a researcher who just found eleven names worth following,
I want them saved to a named watchlist along with a record of which run
produced them,
so that the work survives the tab, and so that in three weeks I can still
tell what screen these names came off.

## Acceptance Criteria

1. `upsert_watchlist` creates a static watchlist from a name and a set of
   instruments, with a stable ID.
2. `upsert_watchlist` creates a dynamic watchlist from a name and a
   screener revision; the watchlist is defined by the screener rather
   than a fixed member list and states which revision defines it.
3. `upsert_watchlist` called with an existing watchlist ID updates that
   watchlist in place — name, membership, or definition — and keeps its
   ID.
4. `save_results_to_watchlist` accepts a pinned run ID and a target
   watchlist, adds the run's instruments, and records the source run ID
   and the run's timestamp on the watchlist as provenance.
5. Saving results never re-executes the screener; the saved membership
   matches the pinned run exactly. Saving from an unknown or expired run
   ID is rejected saying so, rather than re-running to cover for it.
6. `save_results_to_watchlist` can save a selected subset of a run's
   results; only the selected instruments are added.
7. Membership is deduplicated by instrument ID, and the response reports
   how many of the incoming instruments were already present.
8. Saving into a dynamic watchlist is handled explicitly — either
   rejected explaining that its membership is screener-defined, or
   converting it with an explicit acknowledgement — never silently
   producing a watchlist whose membership contradicts its definition.
9. A watchlist can be bound to a `watchlist` panel and is visible to the
   researcher there, showing its name, membership, kind (static or
   dynamic), and provenance.
10. A watchlist's contents carry the market-data provenance envelope
    (`as_of`, source, live/delayed status, timezone, currency, price
    adjustment policy) wherever market values are shown.
11. Both tools accept `expected_revision` and `idempotency_key` and
    return the common mutation envelope; a repeated `idempotency_key`
    does not create a duplicate watchlist or add the instruments twice.
12. Undoing either mutation with the returned undo token restores the
    watchlist's prior state — including restoring a deleted membership
    or removing a newly created watchlist — exactly.

## Design References

- `docs/design/screener-followup-tools/spec.md` — "Maintain watchlists"
  scenario table.
- `docs/reference/tool-spec.md` — `upsert_watchlist` and
  `save_results_to_watchlist` ("create dynamic or static watchlists from
  results"); the `watchlist` panel kind in `create_panel`; watchlists as a
  universe input to `set_screener_universe`.
- `docs/plan/EPIC-1007/_epic.md` — the `watchlist` panel kind and how a
  panel binds to a resource.
- `docs/plan/EPIC-1010/_epic.md` — pinned `run_id` semantics, result
  selection, and the no-silent-rerun guarantee.
- `docs/plan/EPIC-1009/_epic.md` — `set_screener_universe`, which
  accepts watchlists as a universe input.
- `docs/plan/EPIC-1006/_epic.md` — mutation envelope, revisions, undo.

## Technical Considerations

- Persistence scope is a working assumption recorded in the epic's Open
  Questions: per-browser, behind a port, so a server-backed store can
  replace it without changing the tool surface.
- Static and dynamic watchlists differ enough in behavior that conflating
  them will cause exactly the silent-contradiction bug AC8 guards
  against. Keep the kinds explicit in the model.
- A dynamic watchlist references a screener revision; deleting or
  superseding that screener needs defined behavior rather than a dangling
  reference.
- Watchlists feed screener universes. A cycle — a screener whose universe
  is a watchlist defined by that same screener — needs to be detected and
  rejected.

## Out of Scope

- The `watchlist` panel kind and its rendering (EPIC-1007).
- Alerts on watchlist membership changes (T-1014-8, T-1014-9).
- Sharing or syncing watchlists across browsers, devices, or users.
- Importing a watchlist from an external file or broker.
