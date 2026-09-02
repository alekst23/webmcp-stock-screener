# T-0016-12: No synthetic data in production

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Done -- `REQUIRE_REAL_PANEL` guard plus the `render.yaml` drift fix; merged to `main` 2026-09-02
**Depends on**: T-0016-3
**Blocks**: —
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

Two defects surfaced while consolidating Wave 1 of this epic.

**Defect 1 — a rename silently repoints production at synthetic data.**
T-0016-3 renamed the object-store environment variables from `R2_BUCKET_NAME`
/ `R2_ENDPOINT_URL` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` to
`OBJECT_STORE_*`, cutting the old names rather than aliasing them — a
deliberate choice, per that ticket's own dead-code-policy reasoning. But
`render.yaml` still declares only the old names, on both the web service and
the cron (lines 74-80 and 108-114). Verified against `backend/main.py` and
`backend/infra/object_store.py`, which read only `OBJECT_STORE_*`.

If this branch reaches `main` and Render redeploys before T-0016-11
decommissions it, the bucket is unnamed, `config_from_env` returns `None`,
and `load_panel` falls back to the mock panel — Render would serve synthetic
prices as though they were real, invisibly, while passing its health check.
That is precisely the hazard this epic exists to remove, reintroduced by a
rename. It also breaks T-0016-10's rollback requirement: rolling back to
Render is only a rollback if Render still works.

**Defect 2 — production can still silently serve the mock panel.**
The project's decision log (2026-09-01) requires: *"a production deploy must
refuse to start on the mock panel rather than fall back to it."*  T-0016-3
correctly made "configured but unreachable" fail loudly (`ensure_reachable`),
but "not configured at all" still silently degrades to mock — correct for a
local checkout, wrong for production, and with nothing today to tell the two
apart at startup.

Done looks like: `render.yaml` matches the object-store contract T-0016-3
actually shipped, and a production deploy has an explicit, opt-in way to
refuse to start on synthetic data instead of serving it invisibly.

## User Story

As the person operating this deployment,
I want Render's declared configuration to match the code it deploys, and a
way to make a production deploy refuse synthetic data outright,
so that a rename cannot silently repoint a live deploy at the mock panel,
and so that "configured" is the only way a production process is allowed to
start.

## Acceptance Criteria

1. `render.yaml` declares `OBJECT_STORE_BUCKET`, `OBJECT_STORE_ENDPOINT_URL`,
   `OBJECT_STORE_ACCESS_KEY_ID`, and `OBJECT_STORE_SECRET_ACCESS_KEY` — not
   the old `R2_*` names — on both the web service and the cron, and its
   explanatory comments describe the current object-store contract (S3
   primary, R2 still supported) rather than R2-only behavior.
2. A new environment variable, off by default, gates a stricter startup
   check. With it unset or falsy, behavior is unchanged from today: an
   unconfigured object store falls back to the mock panel, and every
   existing test and local checkout keeps working with no edits.
3. With the variable set truthy and the object store not configured at all
   (no bucket named), startup fails loudly with a message naming
   `OBJECT_STORE_BUCKET` as unset, and the process never serves the mock
   panel.
4. With the variable set truthy and the object store configured and
   reachable, startup proceeds exactly as it does today and serves the real
   panel.
5. With the variable set truthy and the object store configured but
   unreachable, T-0016-3's existing `ensure_reachable` failure fires
   unchanged — this ticket does not duplicate that check.
6. Failure messages produced by the new guard name the missing
   configuration variable and never echo a secret value.
7. `render.yaml` sets the new variable for the production web service only
   — the cron already refuses to run unconfigured via
   `scripts/_cli_env.require_panel_store`, so the same guard there would be
   redundant.
8. `backend/.env.example` documents the new variable: its name, default, and
   what enabling it does.

## Design References

- `render.yaml` — lines 74-80 (web service `envVars`) and 108-114 (cron
  `envVars`), the drifted `R2_*` names; also the explanatory comment block
  at the top (lines 1-23) which still describes R2-only behavior
- `backend/application/load_panel.py` — the three-state contract this
  ticket adds a fourth, opt-in state to: `store is None` today always means
  "fall back to mock"; with the new flag it means "refuse to start" instead
- `backend/infra/object_store.py` — `config_from_env`, `_BUCKET_VAR`; the
  bucket is the sole signal of "configured", which is what the new guard's
  message names
- `backend/main.py` — `_panel_store`, `_load_engine`, `_lifespan`; where the
  new flag is read and threaded through
- `backend/scripts/_cli_env.py` — `require_panel_store`, the ingestion
  scripts' existing unconditional version of this same refusal, which is
  why the cron does not need the new flag
- `backend/tests/functional/test_panel_disclosure.py` — `TestUnreachableStore`,
  the existing pattern for testing `load_panel`'s fail-loud paths without a
  live bucket

## Technical Considerations

Per the project's dead-code policy, a new branch in an existing function
(`load_panel`) is a modification to existing behavior and needs a feature
flag until it is proven safe — this ticket's environment variable is that
flag. Defaulting it off is what keeps every existing test and every local
checkout passing unmodified; the whole point is that flipping it is an
explicit, deliberate choice a production deploy makes, not an implicit
consequence of upgrading this branch.

The flag only changes the `store is None` branch. It must not duplicate or
race `ensure_reachable()` — a configured-but-unreachable store already
aborts startup today, unconditionally, and that path is left untouched.

`render.yaml`'s comment block (lines 8-11, 70-73) describes the
object-store fallback in R2-specific language left over from before
T-0016-3; it is corrected here since the variable rename it should have
accompanied did not happen.

## Out of Scope

A configured-and-reachable store whose bucket is simply empty (no
`panel.parquet` uploaded yet) still falls back to the mock panel today, flag
on or off — T-0016-7 (migrating the real panel into the bucket) is what
makes that state not arise in production, not this ticket. Changing
`ensure_reachable`'s behavior or error text (T-0016-3). Any Terraform or AWS
resource change (T-0016-4, T-0016-6, sibling agent's scope). Decommissioning
Render (T-0016-11, user-gated).

## Solution Approach

### render.yaml

Rename the four `envVars` keys on both the web service and the cron from
`R2_BUCKET_NAME` / `R2_ENDPOINT_URL` / `R2_ACCESS_KEY_ID` /
`R2_SECRET_ACCESS_KEY` to `OBJECT_STORE_BUCKET` / `OBJECT_STORE_ENDPOINT_URL`
/ `OBJECT_STORE_ACCESS_KEY_ID` / `OBJECT_STORE_SECRET_ACCESS_KEY` — a pure
rename, `sync: false` unchanged, same position in the file. Add
`OBJECT_STORE_REGION` (also `sync: false`) alongside them since
`config_from_env` reads it and R2 needs `"auto"` — T-0016-3's rename left it
uncovered here too. Rewrite the top-of-file comment block and the web
service's inline comment above `envVars` to describe the current contract
(bucket-only is "configured"; everything else optional; unreachable-but-
configured fails loudly) instead of R2-only behavior. Add
`REQUIRE_REAL_PANEL`, `value: "true"`, to the web service's `envVars` only.

### The strictness flag

Environment variable: `REQUIRE_REAL_PANEL`. Truthy values: `"true"` or
`"1"` (case-insensitive), matching how the rest of `main.py` already reads
flags. Unset or any other value is falsy — the default, unchanged path.

`backend/application/load_panel.py`'s `load_panel` gains a keyword-only
parameter `require_object_store: bool = False`. When `store is None` (the
existing "not configured" signal) and `require_object_store` is `True`, it
raises `PanelStoreError` naming `OBJECT_STORE_BUCKET` before ever touching
`mock_path` — `PanelStoreError` because this is the same domain error type
`ensure_reachable` already raises for the sibling "configured but
unreachable" case, so `main.py`'s lifespan has one exception type to not
catch, and it propagates to a hard startup failure the same way. When
`store` is not `None`, the parameter is not consulted at all — that branch
already either returns a real panel or lets `ensure_reachable` raise, which
is AC5's "do not duplicate" requirement satisfied by construction rather
than by an added check.

`backend/main.py` gains `_require_real_panel() -> bool`, reading
`REQUIRE_REAL_PANEL` the same way `_rate_limit_default` and
`_allowed_origins` already read their own variables. `_load_engine` passes
`require_object_store=_require_real_panel()` into `load_panel`.

### Why the message names only the bucket

`config_from_env` treats the bucket as the sole signal of "configured" — see
its own docstring. `store is None` therefore always means exactly one thing:
`OBJECT_STORE_BUCKET` was blank. The new guard's message names that
variable directly rather than re-deriving it through
`missing_object_store_vars()`, which would introduce a second, live read of
`os.environ` inside `load_panel` — a function whose existing tests pass it
fakes and never touch the environment. No secret is ever in scope for this
message: it fires before any credential is read.

### Tests

New tests in `backend/tests/functional/test_panel_disclosure.py` (the
existing home for `load_panel`'s fail-loud paths):

- strict + unconfigured (`store=None, require_object_store=True`) raises
  `PanelStoreError` naming `OBJECT_STORE_BUCKET`, and never reads
  `mock_path` (assert via a mock path that would raise if opened, or assert
  no panel content leaks into the exception).
- strict + configured and reachable (`InMemoryPanelStore` with the panel
  key present, `require_object_store=True`) returns the real panel exactly
  as the non-strict case does.
- strict off (default) + unconfigured still falls back to mock — pins
  today's behavior so the flag's default path cannot regress.
- a `render.yaml`-drift regression test: parses `render.yaml` and asserts
  its declared env var keys are a subset of (or match) the names
  `infra/object_store.py` actually reads, so a future rename that forgets
  the YAML fails CI instead of waiting for a live redeploy.
