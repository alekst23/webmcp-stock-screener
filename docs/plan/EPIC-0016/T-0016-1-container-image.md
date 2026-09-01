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
