# T-0016-7: Migrate panel objects from R2 to S3

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open
**Depends on**: T-0016-3, T-0016-4
**Blocks**: T-0016-8, T-0016-9
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

The stored panel is the only thing in this system that cannot be recreated
for free. `backend/application/load_panel.py` reads two objects — the panel
and the universe CSV — and regenerating the panel means running
`backfill_panel.py` against the paid EODHD plan, spending real quota and real
money for data that already exists in R2. Migrating the bytes is strictly
cheaper than re-fetching them, and it also preserves the exact dataset every
recorded measurement was taken against.

Done looks like: the S3 bucket holding objects byte-identical to R2's, the
new service reading them and reporting the same as-of date, and R2 still
intact as the rollback source until T-0016-11.

## User Story

As the person migrating this,
I want the existing panel objects copied to S3 and verified,
so that the AWS deployment serves the same data the Render one did, without
paying for another backfill or silently starting from an empty bucket.

## Acceptance Criteria

1. Every object the application reads from R2 exists in the S3 bucket with
   the same key.
2. Copied objects are verified byte-identical to their sources, not merely
   present and non-empty.
3. A service configured against S3 loads the panel and reports the same as-of
   date, row count, and source provenance as the same panel loaded from R2.
4. The R2 objects are left in place and unmodified, so rollback needs no
   restore step.
5. The migration procedure is written down and is repeatable, so it can be
   re-run immediately before cutover to pick up nights the Render cron
   appended in the meantime.
6. If R2 holds no panel yet, that is reported as an explicit finding with the
   backfill cost of producing one, rather than being papered over by an empty
   bucket that degrades to the mock panel.

## Design References

- `backend/application/load_panel.py` — `PANEL_KEY` and `UNIVERSE_KEY`: the
  exact objects in scope, and the fallback behavior AC6 guards against
- `backend/infra/object_store.py` — the R2 connection details the source side
  uses
- `backend/scripts/backfill_panel.py`, `backend/scripts/load_universe_metadata.py`
  — what producing these objects from scratch would cost instead
- `docs/reference/data-provider.md` — EODHD quota and pricing, for AC6's cost
  statement
- T-0016-4 — the destination bucket and its versioning

## Technical Considerations

R2 is not a valid source for a server-side S3 copy: the two are different
accounts on different providers, so this is a download-and-upload through
some intermediary, not a server-side operation. The panel is on the order of
60–90 MB, so a laptop round-trip is entirely adequate and needs no
infrastructure. `rclone` speaks both endpoints natively and does the
verification in AC2; a short boto3 script against two clients works equally
well and reuses the credentials already configured.

AC5 exists because of timing. The Render cron keeps appending a session every
night at 06:30 UTC until T-0016-11 turns it off, so whatever is copied during
this ticket will be stale by cutover. Making the procedure repeatable is
cheaper than reasoning about a freeze window. Until cutover, exactly one
writer must be appending at a time — a Render cron and an AWS scheduled job
both rewriting the same logical panel in different buckets is a divergence,
not a backup.

Bucket versioning (T-0016-4 AC5) is the safety net for the copy itself as
much as for the nightly job.

## Out of Scope

Deleting anything from R2 (T-0016-11). Running a fresh backfill. Any change
to the panel's format or partitioning.
