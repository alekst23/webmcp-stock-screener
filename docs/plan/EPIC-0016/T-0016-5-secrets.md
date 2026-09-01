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

## Solution Approach

### Secrets Manager vs. SSM Parameter Store

**SSM Parameter Store**, `SecureString` type, standard tier, encrypted under
the account's default AWS-managed key (`alias/aws/ssm`, already present in
this account from unrelated prior use — no new key to provision).

Standard-tier `SecureString` parameters cost nothing: no per-parameter
monthly charge and no API charge at this call volume (one read per task
start, at most a few per day). Secrets Manager charges roughly
$0.40/secret/month plus $0.05 per 10,000 API calls, and what that price buys
— automatic rotation via a Lambda rotation function, cross-region
replication — has no use here: rotation in this project means an operator
runs `aws ssm put-parameter --overwrite` and the next task start picks it
up (AC5), which is exactly what Parameter Store already does with no extra
machinery. One secret does not justify paying for rotation tooling nobody
will wire up. Either service would satisfy every AC in this ticket; the
choice is cost and simplicity, not capability, per the ticket's own
Technical Considerations.

### Secret vs. configuration

T-0016-3 already moved object-store authentication onto the default AWS
credential chain (the application role, `webmcp-prod-app-role`) and cut the
static-key code path's variable names (`R2_ACCESS_KEY_ID` /
`R2_SECRET_ACCESS_KEY` no longer exist; see `backend/infra/object_store.py`
and `backend/.env.example`). That leaves exactly **one** runtime secret:

| Variable | Secret? | AWS home |
|---|---|---|
| `EODHD_API_KEY` | **Secret** | SSM Parameter Store `SecureString`, read by the app role |
| `RATE_LIMIT_DEFAULT` | Config | Plain environment value on the App Runner service / Fargate task definition (T-0016-6 / T-0016-8) |
| `CORS_ALLOWED_ORIGINS` | Config | Plain environment value, same as above |
| `OBJECT_STORE_BUCKET` | Config | Plain environment value, set from this Terraform's `panel_bucket_name` output |
| `OBJECT_STORE_REGION` | Config | Plain environment value, `us-east-1` |
| `OBJECT_STORE_ENDPOINT_URL` | N/A | Left unset — only needed for a non-AWS S3-compatible endpoint (R2), and production now targets real S3 |
| `OBJECT_STORE_ACCESS_KEY_ID` / `OBJECT_STORE_SECRET_ACCESS_KEY` | N/A | Left unset — the app role supplies credentials via the default chain |

This satisfies AC3: no bucket name, region, rate limit, or CORS origin is
stored as a secret. Wiring these plain values into the actual service/task
definition belongs to T-0016-6 and T-0016-8; this ticket's Terraform scope
is the secret parameter itself, the read grant, and documentation of the
full set (AC7).

### AC8 — what T-0016-11 must revoke

Render's `sync: false` fields (`render.yaml`) were: `EODHD_API_KEY`,
`CORS_ALLOWED_ORIGINS`, `R2_BUCKET_NAME`, `R2_ENDPOINT_URL`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (six on the web service, the same
minus `CORS_ALLOWED_ORIGINS` — five — on the cron job).

- `EODHD_API_KEY` is **not** orphaned — the same credential is carried
  forward into the new SSM parameter, not reissued.
- `CORS_ALLOWED_ORIGINS`, `R2_BUCKET_NAME`, `R2_ENDPOINT_URL` were never
  secrets and have no revocation step; the bucket and endpoint they named
  (Cloudflare R2) are being replaced outright, not migrated.
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — the Cloudflare R2 API token
  pair that let Render's static-key code path authenticate to R2 — **is**
  orphaned. Nothing on AWS uses it or replaces it in place (the app role's
  credential chain is a different mechanism entirely, on a different
  provider). **T-0016-11 must revoke this R2 API token in Cloudflare's
  dashboard** (Manage R2 API Tokens) when Render is decommissioned, rather
  than leave it live and unused.

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
