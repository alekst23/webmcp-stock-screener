# T-0016-3: Provider-neutral object store on the AWS credential chain

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open
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
