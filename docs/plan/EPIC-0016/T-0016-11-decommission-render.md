# T-0016-11: Decommission Render (user-gated)

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open — **user-gated, must not be run unattended**
**Depends on**: T-0016-10
**Blocks**: —
**Issue**: #16
**Design**: docs/design/aws-replatform/

Resolves #16

## Description

Render is the rollback path. Until it is turned off, every earlier ticket in
this epic is reversible; the moment it is turned off, none of them are. That
asymmetry is the whole reason this is the last ticket and the only one gated
on an explicit human decision.

Two services go: the free `web` service `webmcp-pattern-research-api`, and
the paid `cron` `webmcp-panel-nightly-delta` on the `starter` plan — the
latter being the only recurring Render cost, and the only one whose removal
saves money. Alongside them are the hand-entered `sync: false` dashboard
secrets, which are live credentials to a paid EODHD plan and to writable
object storage. Deleting a service does not revoke a credential; an
orphaned key with panel write access is a worse outcome than a running free
service.

The R2 bucket is a separate decision from Render and should be made
separately. It costs almost nothing, and it is the only remaining copy of the
pre-migration panel.

Done looks like: nothing running on Render, no live credential without an
owner, `render.yaml` removed or explicitly retained with a stated reason, and
a user who chose each of those.

## User Story

As the person paying for this,
I want the old platform shut down only once I have said so and only once its
replacement is proven,
so that the recurring cost stops without the rollback path disappearing
before anyone is confident.

## Acceptance Criteria

1. Explicit user approval is obtained and recorded before any Render resource
   is deleted or any credential revoked.
2. Before approval is sought, the AWS deployment is confirmed still healthy —
   API serving, nightly job having run successfully at least once on its real
   schedule, panel as-of date current.
3. The Render web service and the paid cron service are both removed, and the
   removal of the paid one is confirmed to have ended its recurring charge.
4. Every credential created for Render is either revoked or explicitly
   retained with a stated reason and an owner, with none left live and
   unaccounted for.
5. `render.yaml` is removed from the repository, or retained with a comment
   stating why and noting that it no longer describes a live deployment.
6. Documentation that refers to Render as the live deployment is updated so
   that no reader can act on it as current, including the live-URL table.
7. The fate of the R2 bucket is decided explicitly by the user — retained as
   an archive, or deleted — rather than left as an unowned remnant.
8. After decommissioning, the live workbench is verified end to end once more
   and the result recorded.

## Design References

- `render.yaml` — the two services, their plans, and the eleven `sync: false`
  variables across them that AC4 enumerates
- `docs/reference/deployment.md` — the live-URL table and verification record
  AC6 updates
- T-0016-10 — the cutover record, which AC2 checks against and whose AC9
  checklist this ticket executes
- `docs/plan/project.md` — the decision log where AC1's approval and AC7's
  choice belong

## Technical Considerations

The paid `starter` cron is the only line item that saves money here. The
free web service costs nothing to leave running, and leaving it running for a
while after the cron is removed is a legitimate, cheap way to keep a warm
rollback target — worth offering as an option rather than assuming both go at
once.

AC4 is the part most likely to be skipped. Render's dashboard secrets include
an EODHD key on a paid plan with a 100,000-unit daily quota and object-storage
credentials with write access to the panel. If T-0016-3's recommended
credential-chain approach was taken, the storage keys may already be unused on
AWS — which makes revoking them free, and makes not revoking them
inexcusable.

Nothing in this ticket is reversible. Treat every step as one-way and confirm
AC2 immediately before acting, not from an earlier ticket's record.

## Out of Scope

Anything on Cloudflare Workers — the frontend stays. Deleting the R2 bucket
without the explicit decision AC7 requires. Any AWS change.

Resolves #16
