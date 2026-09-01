# T-0016-5: Runtime secrets in AWS, out of the gitignored `.env`

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open
**Depends on**: T-0016-4
**Blocks**: T-0016-8
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

Today the EODHD API key and the storage credentials live in two places: a
gitignored root `.env` on the user's machine, and hand-entered Render
dashboard fields — `render.yaml` marks six variables `sync: false` on the web
service and five on the cron, which means a human typed each of them into a
form. There is no record of what was set, no rotation path, and the only
durable copy is on one laptop.

The EODHD key is not a nominal secret. It authenticates a paid plan with a
100,000-unit daily quota, and the backfill spends real money per call; the
storage credential grants write access to a panel that costs a paid backfill
to reproduce.

Done looks like: every runtime secret stored in AWS, injected into the
container by reference rather than by value, with the plaintext appearing
nowhere in the repo, the image, the task definition, or a log.

## User Story

As the person operating this,
I want secrets held in AWS and referenced by the task,
so that the deployment does not depend on a laptop's `.env`, and so that
rotating a credential does not mean editing a dashboard form by hand.

## Acceptance Criteria

1. Every secret the runtime needs — the EODHD API key and any storage
   credential — is stored in AWS as an encrypted value, created outside
   version control.
2. Secret *values* are absent from Terraform state, the repository, the
   container image, and the task definition; the task definition carries only
   references.
3. Non-secret configuration (rate limit, allowed origins, bucket name,
   region) is passed as ordinary environment values, not as secrets.
4. The application identity can read exactly the secrets it needs and no
   others.
5. Rotating a secret's value takes effect on the next task start with no code
   change and no infrastructure change.
6. A secret value never appears in application logs or in platform logs,
   including on the failure paths that name missing configuration.
7. The set of required secrets, where each lives, and how to populate one for
   the first time are documented well enough for someone with account access
   and no prior context to bring up the deployment.
8. Any secret that was created for Render and is not needed on AWS is
   identified, so T-0016-11 can revoke rather than orphan it.

## Design References

- `render.yaml` — the `sync: false` variables on both services: the full set
  that needs an AWS home, and the evidence that they are currently
  hand-entered
- `backend/.env.example` — what each variable holds and which are required
  together
- `backend/scripts/_cli_env.py` — the failure messages that name unset
  variables, which AC6 must keep secret-free
- `docs/reference/data-provider.md` — the EODHD plan and quota this key
  authenticates
- T-0016-3 — whether a storage credential is needed at all, or whether the
  task role replaces it

## Technical Considerations

Choose between Secrets Manager and SSM Parameter Store deliberately and
record the reason. Parameter Store's standard tier is free and adequate for a
handful of values injected at task start; Secrets Manager charges per secret
per month and buys rotation machinery this project has no use for yet. Either
satisfies every AC here — the argument is cost and simplicity, not
capability.

If T-0016-3's recommended default is taken, the storage access key and secret
stop existing entirely and the task role replaces them. In that case this
ticket's real scope collapses to the EODHD key alone, which is the better
outcome: one secret is easier to rotate correctly than three.

AC6 is not hypothetical. `_cli_env.py` exits with messages that name unset
variables; that is correct and must stay, but the same care has to hold
wherever configuration is echoed at startup.

## Out of Scope

Automated rotation schedules. Secrets for infrastructure that does not exist
yet — the RDS/Aurora credentials in particular, since nothing in this epic
connects to the database. Removing the local `.env`, which stays as the
local-development path.
