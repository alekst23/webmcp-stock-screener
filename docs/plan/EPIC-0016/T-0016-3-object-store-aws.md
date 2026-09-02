# T-0016-3: Provider-neutral object store on the AWS credential chain

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Done -- object store resolves on the AWS credential chain; landed and merged to the epic branch, and to `main` 2026-09-02
**Depends on**: —
**Blocks**: T-0016-6, T-0016-7, T-0016-8
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

The issue's premise — that S3 is "an endpoint/credential change rather than a
code change" — was verified against `backend/infra/object_store.py` and is
**mostly** right. `S3PanelStore` is a plain boto3 `s3` client; `object_exists`,
`get_object`, and `put_object` use only the common S3 verbs, and `_is_not_found`
already tolerates both providers' disagreement about missing-object codes.

Three things are genuinely code, not configuration:

1. **The region is hardcoded.** `_R2_REGION = "auto"` is passed as
   `region_name`, because R2 has no regions but SigV4 still needs a scope
   name. Against real S3, "auto" is not a region.
2. **The endpoint is mandatory.** `config_from_env` requires
   `R2_ENDPOINT_URL` and returns `None` without it. S3 does not need a custom
   endpoint at all, and supplying one by hand forgoes boto3's own regional
   resolution.
3. **Static credentials are mandatory, and their absence is silent.**
   `config_from_env` requires an access key and secret, and returns `None`
   when either is blank. `load_panel` reads `None` as "no store" and falls
   back to the mock panel. On a role-based AWS deploy with no static keys,
   the service would start, pass its health check, and serve synthetic data
   while looking entirely healthy. That is the worst available failure mode
   and this ticket exists mainly to remove it.

The four `R2_`-prefixed variable names also stop being honest once the bucket
is S3.

Done looks like: the adapter authenticates through the standard AWS
credential chain when no static keys are supplied, still works against R2
when they are, and a store that was configured but cannot be reached fails
loudly instead of degrading to mock data.

## User Story

As the deployed service,
I want to reach object storage through the container's own identity,
so that no long-lived access key exists to leak, and so that a
storage misconfiguration surfaces as an error rather than as silently
synthetic results.

## Acceptance Criteria

1. With only a bucket name configured and credentials available from the
   ambient AWS credential chain, the service reads the real panel from S3.
2. With static credentials and a custom endpoint configured, the adapter
   still works unchanged against an S3-compatible endpoint, including R2.
3. Configuration variable names are provider-neutral rather than
   `R2_`-prefixed, and the example environment file documents which are
   required, which are optional, and what each is for.
4. When object storage is configured but unreachable — wrong bucket, denied
   permission, bad credentials — startup fails with an error naming the
   bucket and the cause, and does not fall back to the mock panel.
5. When object storage is not configured at all, the existing mock-panel
   fallback is unchanged, so a local checkout and every existing test still
   boot without credentials.
6. The ingestion scripts continue to refuse to run when required
   configuration is missing, naming what is unset.
7. Errors crossing the adapter boundary remain wrapped in the domain error
   type with the original exception chained.
8. Existing object-store tests pass without modification to their intent, and
   new tests cover the credential-chain path and the fail-loud path of AC4.

## Solution Approach

### Config shape

`ObjectStoreConfig` becomes:

| Field | Type | Required |
|-------|------|----------|
| `bucket` | `str` | Yes — the only field `config_from_env` requires |
| `endpoint_url` | `str \| None` | No — set for R2 or any non-AWS S3-compatible endpoint |
| `region` | `str \| None` | No — passed as `region_name`; `None` lets boto3 resolve its own ambient region |
| `access_key_id` | `str \| None` | No — paired with `secret_access_key` |
| `secret_access_key` | `str \| None` | No — paired with `access_key_id` |

Env vars drop the `R2_` prefix: `OBJECT_STORE_BUCKET`,
`OBJECT_STORE_ENDPOINT_URL`, `OBJECT_STORE_REGION`,
`OBJECT_STORE_ACCESS_KEY_ID`, `OBJECT_STORE_SECRET_ACCESS_KEY`. The old
`R2_*` names are cut, not aliased — per the project's dead-code policy,
back-compat shims are not carried forward, and `render.yaml` (which still
declares the old names) is explicitly out of this ticket's scope; it becomes
T-0016-6's and T-0016-8's environment contract to replace as those tickets
retire the Render deploy.

### Deciding the three states

`config_from_env` now returns `None` only when `OBJECT_STORE_BUCKET` is
blank — that is the entire test for "not configured". Any other field being
blank just means "let boto3's default resolution handle it" (ambient region,
default credential chain).

`missing_object_store_vars` narrows the same way: it reports `OBJECT_STORE_BUCKET`
alone, since that is the only variable that is ever unconditionally required.

"Configured and reachable" vs. "configured and unreachable" cannot be
decided by `config_from_env` — it never talks to the bucket. It is decided
at the point the store is first used. `S3PanelStore` gains
`ensure_reachable()`, which calls `head_bucket`. Any failure — wrong bucket,
denied permission, unresolvable credentials (boto3 raises `NoCredentialsError`,
a `BotoCoreError`, when the chain comes up empty) — is caught and re-raised
as `PanelStoreError`, chained via `from exc`, naming the bucket.

This is deliberately a *different* check from `object_exists`. `object_exists`
answers "is this key present in a bucket we can already reach" and its 404
handling stays a plain `False` — an empty bucket on a first deploy is not a
failure. `head_bucket` answers "can we reach the bucket at all", which is
the question AC4 is actually about; conflating the two was the latent bug —
S3 can return a bare 404 for `HeadObject` against a bucket that does not
exist at all, which the existing `_is_not_found` heuristic would have
swallowed as "object just isn't there yet", silently handing the mock panel
to a genuinely wrong-bucket deploy.

`load_panel` calls `store.ensure_reachable()` first, before `object_exists`,
whenever `store is not None`. It does not catch what that raises — an
unreachable, configured store is meant to abort startup, not degrade to
`None`/mock. `PanelStore`'s Protocol and `InMemoryPanelStore` both gain the
method (a no-op on the fake, which only ever models an already-reachable
store).

### Why no feature flag

The ticket's own Technical Considerations note flags AC4 as behavior change
in an existing code path, which the project's dead-code policy would
normally gate behind a flag. This change is deliberately not flagged:

- The new failure path only ever fires when `OBJECT_STORE_BUCKET` is set.
  Every existing test run and every local checkout leaves it unset, so the
  guarded path is unreachable for them regardless of a flag.
- The only environment that could hit it today is the live Render deploy —
  and that deploy's env vars are named `R2_*`, which this ticket removes.
  Render's `config_from_env` call returns `None` (bucket unset under the new
  names) until a human re-provisions it, at which point they are
  deliberately opting into the new contract.
- AC4 is not an incidental side effect of this ticket; it is the ticket's
  stated reason for existing (see Description). Flagging it off would ship
  a ticket whose entire point is disabled by default.

A flag would need to be threaded through `main.py`, `load_panel`, and
`S3PanelStore` for a code path that cannot fire against any environment this
repo's tests or local checkouts exercise, and that the next tickets in this
epic (T-0016-6/7/8) depend on being live. That cost buys no safety here.

## Design References

- `backend/infra/object_store.py` — `ObjectStoreConfig`, `config_from_env`,
  `missing_object_store_vars`, `S3PanelStore`, `_is_not_found`; the client is
  already injectable, so AC8's new cases need no live bucket
- `backend/application/load_panel.py` — where `None` becomes the mock
  fallback, and the docstring arguing that fallback is not a transitional
  shim
- `backend/scripts/_cli_env.py` — `require_panel_store`, the CLI-side
  contract AC6 preserves
- `backend/.env.example` — the four `R2_*` variables and their documentation,
  which AC3 rewrites
- `render.yaml` — the same four names appear on both services and become
  T-0016-6's and T-0016-8's environment contract

## Technical Considerations

AC4 changes the behavior of an existing code path — configured-but-broken
storage currently degrades to mock rather than failing. Per the project's
dead-code policy that is a modification to existing behavior, not new
isolated code, so it needs a feature flag or an equivalent guard until the
AWS deploy is verified. Distinguishing "not configured" from "configured but
broken" is the whole trick: absence of a bucket name is the former, a
permission or credential failure against a named bucket is the latter.

Do not remove the fallback for the unconfigured case. Every test run and
every local checkout depends on it, and T-0016-1's image may ship the mock
panel precisely so it keeps working.

Region and endpoint are coupled: supplying a region and no endpoint is the
S3 path, supplying both is the compatible-endpoint path. `"auto"` must not
survive as a default on the S3 path.

## Out of Scope

Moving the objects themselves (T-0016-7). Provisioning the bucket, the IAM
policy, or the task role (T-0016-4). Any change to the panel file format,
the `PanelStore` contract's shape, or `PriceBar`.
