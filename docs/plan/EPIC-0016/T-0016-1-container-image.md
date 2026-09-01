# T-0016-1: Container image for the backend

**Epic**: EPIC-0016 (AWS Re-platform)
**Status**: Open
**Depends on**: —
**Blocks**: T-0016-6, T-0016-8
**Issue**: #16
**Design**: docs/design/aws-replatform/

## Description

The repo has no Dockerfile — verified: nothing matching `Dockerfile*` exists
on `main` or on `epic/EPIC-0013-market-data-storage`. Render builds the
backend natively from `render.yaml`'s `buildCommand`, which installs `uv`
onto the platform's own virtualenv and then runs `uv sync --frozen`. AWS has
no equivalent; every remaining ticket in this epic needs a runnable image
before it has anything to deploy.

The image must serve both roles the Render blueprint splits across two
services: the long-running API and the batch entry point. Building two images
would double the build, double the drift surface, and give the nightly job a
different dependency closure than the API it writes the panel for.

Done looks like: one image that runs the API by default and a script by
argument, built reproducibly from `uv.lock`, small enough that a task launch
is not dominated by image pull.

## User Story

As the deployment,
I want a single container image that runs either the API or an ingestion
script,
so that the service and the nightly job cannot drift apart in their
dependencies, and neither depends on a hosting platform's build conventions.

## Acceptance Criteria

1. Building the image from a clean checkout produces a runnable container
   with no manual steps, on a machine that has only a container runtime.
2. The default command starts the API, listening on a port supplied by the
   environment, and responds to HTTP on that port.
3. The same image, given an alternate command, runs each of the ingestion
   scripts (backfill, nightly delta, universe metadata load) and reaches the
   same argument parsing and failure messages as running them locally.
4. Installed dependencies match `uv.lock` exactly — the build fails rather
   than resolving a newer version.
5. No secret, credential, `.env` file, or real data file is present in any
   image layer.
6. The image contains no build toolchain or test dependency that the runtime
   does not need.
7. The container runs as a non-root user.
8. The build is layer-cached such that a change to application source does
   not reinstall dependencies.

## Solution Approach

### Base image

`python:3.10-slim` (Debian, glibc), matching `backend/.python-version` and
the `requires-python = ">=3.10"` floor in `pyproject.toml`. Glibc rather than
`-alpine`: `pandas`, `pyarrow`, and `numpy` ship manylinux wheels built
against glibc, so slim gets prebuilt wheels for the whole dependency closure
with nothing to compile at install time — Alpine's musl libc would force
source builds of exactly the three packages `pyproject.toml` calls out as
size-dominant, which is slower and, for `pyarrow`, not reliably buildable
from source at all. Slim over the full `python` image because none of the
OS packages the full image adds (build toolchains, editors, `git`) are ever
needed at runtime, and slim's smaller base compounds with the multi-stage
split below.

### Layer strategy (AC8)

Two stages, `builder` and a `python:3.10-slim` runtime stage copying only
`/opt/venv` and the application source out of the builder.

Within `builder`, the dependency install is its own layer, split from the
source copy:

1. `COPY pyproject.toml uv.lock ./` then `uv sync --frozen --no-install-project --no-dev`
   — installs the full dependency closure (boto3, fastapi, numpy, pandas,
   pyarrow, ...) into `/opt/venv` using only the lockfile. Docker's layer
   cache keys this on the hash of `pyproject.toml`/`uv.lock` alone.
2. `COPY . .` then `uv sync --frozen --no-dev` — copies application source
   and re-runs sync. `backend`'s `pyproject.toml` has no `[build-system]`
   (`uv.lock` records `source = { virtual = "." }`), so there is no package
   of its own to build here; this second sync is a fast no-op against an
   already-satisfied lock, not a reinstall.

A source-only change (editing `api/`, `domain/`, etc.) invalidates layer 2
and everything after it, but layer 1 — the expensive part, since it is what
resolves and unpacks `pandas`/`pyarrow`/`numpy`/`uvicorn[standard]`'s native
wheels — stays cached. This is the layer boundary AC8 requires. `.dockerignore`
(below) keeps files that change on every commit but are irrelevant to the
image (`.git`, `tests/`) from busting either layer unnecessarily.

### Alternate-command entry points (AC3)

No `ENTRYPOINT`; a shell-form `CMD` starts the API by default
(`uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}`, matching
`render.yaml`'s `startCommand`). `docker run <image> python scripts/<name>.py
...` replaces that `CMD` outright — standard `docker run` argv-override
behavior — and runs against the exact same `/opt/venv` the API uses, from
the same `WORKDIR /app` that mirrors `backend/`'s own layout. Because the
interpreter, installed packages, working directory, and source tree are
identical to a local `uv run python scripts/<name>.py`, argument parsing
(`argparse`) and the failure messages `scripts/_cli_env.py` raises
(`require_api_key`, `require_panel_store`) are reached unchanged — nothing
about the entry point construction touches those code paths. This covers
`backfill_panel.py`, `nightly_delta.py`, and `load_universe_metadata.py`
alike; no per-script wrapper is needed.

### AC5 — no secret, credential, `.env`, or real data file in any layer

`.dockerignore` excludes `.env*` (re-allowing nothing — `.env.example`
carries no real values so its exclusion or inclusion is immaterial, and it
is excluded for consistency), `data/` and `*.parquet`/`*.feather` (gitignored
local artifacts — a developer's real backfilled panel must never enter the
build context), and `.git`. The image's own `data/mock/panel.parquet` is not
copied from the host at all: it is generated inside the builder stage by
`scripts/generate_mock_panel.py`, a seeded, deterministic synthetic dataset
(`DEFAULT_SEED = 1001`), so no real data ever crosses the host→image
boundary while still baking in a panel. That panel is what preserves
`load_panel`'s existing fallback (spec.md's "Degraded panel" scenario:
object storage unset → serve mock, stay healthy, disclose synthetic) on AWS
exactly as it behaves today — the alternative, shipping no panel at all,
would turn a missing-object-storage misconfiguration into a hard startup
failure instead of the disclosed-synthetic-data behavior the spec requires
unchanged. It is small (~25 tickers, three years) and reproducible from the
seed, so baking it in costs negligible image size for a real behavioral
guarantee.

### AC6 — no build toolchain or dev/test dependency in the runtime layer

`build-essential` is installed only in the `builder` stage (needed only if a
transitive dependency lacks a wheel for this platform; the multi-stage copy
means it never reaches the runtime image regardless). Both `uv sync` calls
pass `--no-dev`, excluding the `dev` dependency group (`pytest`) from
`/opt/venv` entirely — it is never installed, not merely deleted. `.dockerignore`
excludes `tests/` from the build context, so no test source reaches any
layer either. The runtime stage's own `FROM python:3.10-slim` starts from
the same slim base with no additional OS packages layered on.

### AC7 — non-root

The runtime stage creates a system group/user (`app`) and switches to it
with `USER app` after all `COPY --chown=app:app` steps, before `CMD` runs —
uvicorn and every ingestion script execute as `app`, never `root`.

## Design References

- `render.yaml` — the `buildCommand`/`startCommand` pair this replaces for
  both services, including the `uv sync --frozen` requirement
- `backend/pyproject.toml`, `backend/uv.lock` — the dependency closure:
  boto3, fastapi, httpx, numpy, pandas, pyarrow, pydantic, requests, slowapi,
  uvicorn[standard]; `requires-python = ">=3.10"`
- `backend/scripts/_cli_env.py` — how the scripts resolve configuration and
  the messages they exit with, which AC3 must preserve

## Technical Considerations

`pandas`, `pyarrow`, and `numpy` dominate image size; the `[standard]` extra
on uvicorn pulls further native wheels. A multi-stage build that installs
into a virtualenv and copies it into a slim runtime stage keeps the compiler
toolchain out of the shipped layers.

Render's build generates the mock panel at build time
(`test -f data/mock/panel.parquet || uv run python scripts/generate_mock_panel.py`).
Whether the image carries the mock panel is a real decision, not a detail:
`load_panel` falls back to it when object storage is unset or empty, and
`api/routes/spike.py` reads it directly from disk. Baking it in preserves
that fallback on AWS; leaving it out means a misconfigured deploy fails
loudly instead of quietly serving synthetic data. The panel is small and
deterministic either way — record which was chosen and why.

Render passes the listen port as `$PORT`. Do not hardcode 8000.

## Out of Scope

Where the image is stored and how it is pushed (T-0016-4 provisions the
registry). Any change to application source.
